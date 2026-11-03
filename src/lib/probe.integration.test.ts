import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { decryptBytes } from "@/lib/crypto";
import { PROBE_ID_PREFIX, removeProbePeople, runProbe } from "@/lib/probe";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const url = process.env.TEST_DATABASE_URL;

// A stand-in for the running site: it answers from the test database as Jane does, except where a
// test makes it leak. The real site answering these is shown in docs/incident.md's run.
function fakeSite(
  client: PrismaClient,
  leak?: "export" | "document" | "report" | "decide" | "open",
) {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const cookie = new Headers(init?.headers).get("cookie") ?? "";
    const token = cookie.match(/authjs\.session-token=([^;]+)/)?.[1];
    const session = token
      ? await client.session.findUnique({ where: { sessionToken: token } })
      : null;
    const me = session?.userId;
    const others = await client.user.findMany({
      where: { id: { startsWith: PROBE_ID_PREFIX, not: me } },
      select: { id: true },
    });
    const marker = async (userId: string) =>
      (await client.finding.findFirstOrThrow({ where: { userId } })).title;
    if (url.pathname === "/login") return new Response("sign in");
    if (url.pathname === "/api/auth/providers") return new Response('{"resend":{"id":"resend"}}');
    if (url.pathname === "/api/auth/csrf") return new Response('{"csrfToken":"x"}');
    if (url.pathname === "/api/export") {
      if (leak === "open" && !me) return new Response(await marker(others[0].id));
      if (!me) return new Response("no", { status: 401 });
      if (leak === "open") return new Response("no", { status: 401 });
      const extra = leak === "export" ? await marker(others[0].id) : "";
      return new Response(`${await marker(me)} ${extra}`);
    }
    if (url.pathname.startsWith("/api/documents/")) {
      const id = url.pathname.split("/").pop();
      const row = await client.document.findUniqueOrThrow({ where: { id } });
      if (row.userId !== me && leak !== "document") return new Response("no", { status: 404 });
      return new Response(decryptBytes(row.encryptedBytes).toString());
    }
    if (url.pathname.startsWith("/report/")) {
      const row = await client.finding.findUniqueOrThrow({
        where: { id: url.pathname.split("/").pop() },
      });
      return new Response(row.userId === me || leak === "report" ? row.title : "not found");
    }
    if (url.pathname === "/api/decisions") {
      const { findingId } = JSON.parse(String(init?.body));
      const row = await client.finding.findUniqueOrThrow({ where: { id: findingId } });
      if (leak !== "decide") return new Response("no", { status: 404 });
      await client.decision.create({
        data: { findingId, userId: row.userId, choice: "no", cardSnapshot: {} },
      });
      return new Response("{}", { status: 201 });
    }
    return new Response("?", { status: 500 });
  }) as typeof fetch;
}

describe.skipIf(!url)("the hourly probe", () => {
  let client: PrismaClient;
  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await removeProbePeople(client);
    await client.$disconnect();
  });

  const run = (leak?: Parameters<typeof fakeSite>[1]) =>
    runProbe("http://site.test", { client, fetcher: fakeSite(client, leak) });
  const failed = (result: Awaited<ReturnType<typeof run>>) =>
    result.checks.filter((check) => !check.ok).map((check) => check.name);

  it("passes on a site that keeps people apart", async () => {
    const result = await run();
    expect(failed(result)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.checks.length).toBeGreaterThanOrEqual(10);
  });

  it.each([
    ["export", "the export holds nobody else's data"],
    ["document", "someone else's document is refused"],
    ["report", "someone else's finding page shows nothing"],
    ["decide", "someone else's finding can't be decided"],
  ] as const)("fails on a %s leak", async (leak, name) => {
    const result = await run(leak);
    expect(result.ok).toBe(false);
    expect(failed(result)).toContain(name);
  });

  it("fails when signed-out people get data and sessions stop working", async () => {
    const result = await run("open");
    expect(failed(result)).toEqual(
      expect.arrayContaining(["signed out gets nothing", "a session opens the person's own data"]),
    );
  });

  it("says why in a status or a class, never a response's words", async () => {
    const result = await run("document");
    const detail = result.checks.find((check) => !check.ok)?.detail;
    expect(detail).toBe("marker in the answer");
  });

  it("fails when the site can't be reached, and still cleans up", async () => {
    const result = await runProbe("http://site.test", {
      client,
      fetcher: (() => Promise.reject(new TypeError("down"))) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(await client.user.count({ where: { id: { startsWith: PROBE_ID_PREFIX } } })).toBe(0);
  });

  it("leaves no sample person behind, and they're never counted", async () => {
    await run();
    expect(await client.user.count({ where: { id: { startsWith: PROBE_ID_PREFIX } } })).toBe(0);
    expect(
      await client.analyticsEvent.count({ where: { userId: { startsWith: PROBE_ID_PREFIX } } }),
    ).toBe(0);
  });

  it("removes what an earlier run left behind", async () => {
    await client.user.create({
      data: { id: `${PROBE_ID_PREFIX}left`, email: `${PROBE_ID_PREFIX}left@try.jane.invalid` },
    });
    await run();
    expect(await client.user.count({ where: { id: `${PROBE_ID_PREFIX}left` } })).toBe(0);
  });
});
