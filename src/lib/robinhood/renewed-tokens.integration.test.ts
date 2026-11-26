import { TERMS_VERSION } from "@/config/legal";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRobinhood } from "./__fixtures__/fake-robinhood";

// Renewed tokens are kept whenever they renew what is stored, and never cover a newer sign-in.

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
  requireUser: vi.fn(async () => ({ id: session.userId })),
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
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { forgetMetadataForTests } from "./oauth";
import { refreshConnection } from "./refresh";
import { openSecrets, sealSecrets } from "./secrets";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: checks what was left behind, across tables");
const KEY = Buffer.alloc(32, 9).toString("base64");

const start = () => new Request("http://localhost/api/robinhood/connect");

describe.runIf(url)("the tokens a refresh renews", () => {
  let fake: FakeRobinhood;
  const people: string[] = [];
  // This suite's own fake servers: other suites' sign-in clients may be in use.
  const issuers: string[] = [];

  async function person() {
    const user = await db.user.create({
      data: { email: `rh-${crypto.randomUUID()}@example.com` },
    });
    people.push(user.id);
    return user.id;
  }

  // The person's whole trip: Jane's route, Robinhood's page, and back with a code.
  async function signIn(userId: string) {
    const link = "allow";
    session.userId = userId;
    session.cookie = undefined;
    const started = await connect(start());
    expect(started.status).toBe(303);
    const to = started.headers.get("location") ?? "";
    expect(to.startsWith(`${fake.origin}/oauth?`)).toBe(true);
    expect(to).not.toMatch(/fake-access|fake-refresh/);
    const cookie = started.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    session.cookie = decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("="));
    const page = await (await fetch(to)).text();
    const href = new RegExp(`id="${link}" href="([^"]+)"`).exec(page)?.[1] ?? "";
    return new URL(href.replaceAll("&amp;", "&"));
  }

  async function connected(userId: string) {
    const back = await signIn(userId);
    const answer = await callback(new Request(back));
    expect(answer.status).toBe(303);
    expect(answer.headers.get("location")).toContain("/investments?robinhood=connected");
    session.cookie = undefined;
    return answer;
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AUTH_URL", "http://localhost:3000");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
  });
  afterAll(async () => {
    await system().user.deleteMany({ where: { id: { in: people } } });
    await system().robinhoodOauthClient.deleteMany({ where: { issuer: { in: issuers } } });
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    fake = await new FakeRobinhood().start();
    issuers.push(fake.mcpUrl);
    vi.stubEnv("ROBINHOOD_LINK", "1");
    vi.stubEnv("ROBINHOOD_MCP_URL", fake.mcpUrl);
    vi.stubEnv("KILL_BANKS", "");
    forgetMetadataForTests();
    session.userId = "";
    session.cookie = undefined;
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation(() => {});
    }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fake.stop();
  });

  const rowOf = (userId: string) =>
    system().robinhoodConnection.findUniqueOrThrow({ where: { userId } });
  const later = (seconds: number) => ({ now: new Date(Date.now() + seconds * 1000) });

  it("are kept when a sign-in landed after the lock was taken and before the row was read", async () => {
    const userId = await person();
    await connected(userId);
    // The new sign-in's tokens last under a minute, so the refresh that reads them renews them.
    let signedInAgain = false;
    const watched = db.$extends({
      query: {
        robinhoodConnection: {
          async findFirstOrThrow({ args, query }) {
            if (!signedInAgain) {
              signedInAgain = true;
              fake.options.expiresIn = 30;
              await connected(userId);
              fake.options.expiresIn = undefined;
            }
            return query(args);
          },
        },
      },
    }) as unknown as typeof db;

    expect(await refreshConnection(userId, { client: watched, ...later(1) })).toBe("busy");

    expect(signedInAgain).toBe(true);
    expect(await refreshConnection(userId, later(2))).toBe("updated");
    expect(await rowOf(userId)).toMatchObject({ status: "active", failures: 0 });
  });

  it("never cover a sign-in that landed while they were being renewed", async () => {
    const userId = await person();
    fake.options.expiresIn = 30;
    await connected(userId);
    const { accountKey } = openSecrets((await rowOf(userId)).secretsEncrypted);
    const fresh = sealSecrets({ accessToken: "newer", refreshToken: "newer-refresh", accountKey });
    const real = globalThis.fetch;
    let landed = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const to = input instanceof Request ? input.url : String(input);
      const answer = await real(input, init);
      if (!landed && to.includes("/oauth2/token/")) {
        landed = true;
        await system().robinhoodConnection.updateMany({
          where: { userId },
          data: { secretsEncrypted: fresh, syncingSince: null },
        });
      }
      return answer;
    });

    expect(await refreshConnection(userId, later(1))).toBe("busy");

    expect(landed).toBe(true);
    expect((await rowOf(userId)).secretsEncrypted).toBe(fresh);
  });
});
