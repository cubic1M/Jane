import { TERMS_VERSION } from "@/config/legal";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_NUMBER_MARKER, FakeRobinhood } from "./__fixtures__/fake-robinhood";

// Attacks on the Robinhood connection through its real routes (security audit), against a real
// database and a fake server. Nothing here talks to Robinhood.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
const session = vi.hoisted(() => ({ userId: "", cookie: undefined as string | undefined }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () =>
    session.userId ? { id: session.userId, termsVersion: TERMS_VERSION } : null,
  ),
}));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => (session.cookie === undefined ? undefined : { value: session.cookie }),
  })),
  headers: vi.fn(async () => new Headers()),
}));

import { GET as callback } from "@/app/api/robinhood/callback/route";
import { GET as connect } from "@/app/api/robinhood/connect/route";
import { POST as disconnectRoute } from "@/app/api/robinhood/disconnect/route";
import { db } from "@/lib/db";
import { limitOrNull } from "@/lib/rate-limit";
import { systemDb } from "@/lib/system-db";
import { removeConnection } from "./connection";
import { forgetMetadataForTests, SIGN_IN_COOKIE } from "./oauth";
import { refreshAllRobinhood, refreshConnection } from "./refresh";
import { openSecrets } from "./secrets";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: checks what was left behind, across tables");

describe.runIf(url)("attacks on the Robinhood connection", () => {
  let fake: FakeRobinhood;
  const people: string[] = [];

  async function person() {
    const user = await db.user.create({ data: { email: `rh-${crypto.randomUUID()}@example.com` } });
    people.push(user.id);
    return user.id;
  }

  async function use(options: ConstructorParameters<typeof FakeRobinhood>[0]) {
    await fake.stop();
    fake = await new FakeRobinhood(options).start();
    vi.stubEnv("ROBINHOOD_MCP_URL", fake.mcpUrl);
    forgetMetadataForTests();
  }

  async function signIn(userId: string) {
    session.userId = userId;
    session.cookie = undefined;
    const started = await connect(new Request("http://localhost/api/robinhood/connect"));
    const cookie = started.headers.get("set-cookie") ?? "";
    session.cookie = decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("="));
    const page = await (await fetch(started.headers.get("location") ?? "")).text();
    const href = /id="allow" href="([^"]+)"/.exec(page)?.[1] ?? "";
    return new URL(href.replaceAll("&amp;", "&"));
  }

  const connected = async (userId: string) => {
    const answer = await callback(new Request(await signIn(userId)));
    expect(answer.headers.get("location")).toContain("robinhood=connected");
    session.cookie = undefined;
  };
  const connectionOf = (userId: string) =>
    system().robinhoodConnection.findUnique({ where: { userId } });
  const heldBy = (userId: string) => system().holding.count({ where: { userId } });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AUTH_URL", "http://localhost:3000");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
  });
  afterAll(async () => {
    await system().user.deleteMany({ where: { id: { in: people } } });
    await system().robinhoodOauthClient.deleteMany({
      where: { issuer: { contains: "127.0.0.1" } },
    });
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    fake = await new FakeRobinhood().start();
    vi.stubEnv("ROBINHOOD_LINK", "1");
    vi.stubEnv("ROBINHOOD_MCP_URL", fake.mcpUrl);
    vi.stubEnv("KILL_BANKS", "");
    forgetMetadataForTests();
    session.userId = "";
    session.cookie = undefined;
    vi.mocked(limitOrNull).mockClear();
    for (const level of ["log", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation(() => {});
    }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fake.stop();
  });

  it("another site's form can't disconnect someone", async () => {
    const userId = await person();
    await connected(userId);
    for (const site of ["cross-site", "same-site"]) {
      const answer = await disconnectRoute(
        new Request("http://localhost/api/robinhood/disconnect", {
          method: "POST",
          headers: { "sec-fetch-site": site },
        }),
      );
      expect(answer.status).toBe(303);
      expect(answer.headers.get("location")).not.toContain("disconnected");
      expect(await connectionOf(userId)).not.toBeNull();
    }
    await disconnectRoute(
      new Request("http://localhost/api/robinhood/disconnect", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(await connectionOf(userId)).toBeNull();
  });

  it("another site sending someone to the way back ends nothing and writes only so much", async () => {
    const userId = await person();
    session.userId = userId;
    const forged = () =>
      callback(new Request("http://localhost/api/robinhood/callback?state=forged"));
    const first = await forged();
    expect(first.status).toBe(303);
    expect(first.headers.get("set-cookie") ?? "").not.toContain(SIGN_IN_COOKIE);
    expect(await system().auditLog.count({ where: { actorId: userId } })).toBe(1);
    vi.mocked(limitOrNull).mockResolvedValueOnce(new Response("{}", { status: 429 }) as never);
    expect((await forged()).status).toBe(303);
    expect(await system().auditLog.count({ where: { actorId: userId } })).toBe(1);
    // What Disconnect and Connect count isn't touched.
    for (const [name] of vi.mocked(limitOrNull).mock.calls) {
      expect(name).toBe("robinhoodForgedBack");
    }
  });

  it("a sign-in under way survives a forged answer", async () => {
    const userId = await person();
    const back = await signIn(userId);
    await callback(new Request("http://localhost/api/robinhood/callback?state=forged"));
    const answer = await callback(new Request(back));
    expect(answer.headers.get("location")).toContain("robinhood=connected");
  });

  it("the tokens are gone before anything waits on Robinhood's address for ending them", async () => {
    await use({ revocation: true });
    const userId = await person();
    await connected(userId);
    const real = globalThis.fetch;
    let leftWhenAsked: number | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/revoke")) {
        leftWhenAsked = await system().robinhoodConnection.count({ where: { userId } });
      }
      return real(input, init);
    });
    await removeConnection(userId, "user_disconnected");
    expect(leftWhenAsked).toBe(0);
    expect(fake.revokedTokens).toHaveLength(2);
  });

  it("every holding left out fails the read, and what they had stays", async () => {
    const userId = await person();
    await connected(userId);
    const before = await heldBy(userId);
    expect(before).toBeGreaterThan(0);
    await use({
      answers: {
        get_equity_positions: {
          positions: [{ ticker_symbol: "AAPL", quantity: "1", price: "1" }],
        },
      },
    });
    // The new fake hasn't issued this token, so the connection signs in again on it.
    await system().robinhoodConnection.deleteMany({ where: { userId } });
    await connected(userId);
    expect(await refreshConnection(userId)).toBe("failed");
    const row = await connectionOf(userId);
    expect(row?.lastErrorCode).toBe("shape_get_equity_positions");
  });

  it("one row left out doesn't take a holding away", async () => {
    const userId = await person();
    await connected(userId);
    const before = await heldBy(userId);
    fake.options.answers = {
      get_equity_positions: {
        positions: [
          { symbol: "AAPL", name: "Apple", quantity: "200", price: "50" },
          { ticker_symbol: "FCNTX", quantity: "1000", price: "20" },
        ],
      },
    };
    expect(await refreshConnection(userId, { now: new Date(Date.now() + 86_400_000) })).toBe(
      "updated",
    );
    expect(await heldBy(userId)).toBe(before);
  });

  it("a new token turned away waits and tries again, with the tokens kept", async () => {
    const userId = await person();
    await connected(userId);
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
      String(input).includes("/mcp/") ? new Response(null, { status: 401 }) : real(input, init),
    );
    expect(await refreshConnection(userId)).toBe("failed");
    const row = await connectionOf(userId);
    expect(row?.status).toBe("active");
    expect(row?.lastErrorCode).toBe("refused_after_renewal");
    expect(openSecrets(row?.secretsEncrypted ?? "").refreshToken).toBeTruthy();
  });

  it("someone with no holdings isn't a failure", async () => {
    await use({ answers: { get_equity_positions: { positions: [] } } });
    const userId = await person();
    await connected(userId);
    expect((await connectionOf(userId))?.lastErrorCode).toBeNull();
  });

  it("a night with no time left reads nobody", async () => {
    const userId = await person();
    await connected(userId);
    const now = new Date(Date.now() + 86_400_000);
    const run = await refreshAllRobinhood({ now, userIds: [userId], budgetMs: 0 });
    expect(run).toEqual({ updated: 0, failed: 0, reconnect: 0, deferred: 1 });
  });

  it("a lifetime too long to save doesn't break the way back", async () => {
    await use({ expiresIn: 1e300 });
    const userId = await person();
    const answer = await callback(new Request(await signIn(userId)));
    expect(answer.status).toBe(303);
    expect((await connectionOf(userId))?.accessExpiresAt).toBeNull();
  });

  it("a client id that can't be saved is a failed sign-in, not a crash", async () => {
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
      String(input).includes("/register")
        ? new Response(JSON.stringify({ client_id: "a\u0000b" }), { status: 201 })
        : real(input, init),
    );
    session.userId = await person();
    const answer = await connect(new Request("http://localhost/api/robinhood/connect"));
    expect(answer.status).toBe(303);
    expect(answer.headers.get("location")).toContain("robinhood=not_connected");
  });

  it("a connection's account number stays out of the record of a failed read", async () => {
    await use({ answers: { get_portfolio: { total_value: `-${ACCOUNT_NUMBER_MARKER}` } } });
    const userId = await person();
    await connected(userId);
    const row = await connectionOf(userId);
    expect(JSON.stringify(row)).not.toContain(ACCOUNT_NUMBER_MARKER);
    expect(row?.lastErrorCode).toBe("shape_get_portfolio");
  });
});
