import { TERMS_VERSION } from "@/config/legal";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// With ROBINHOOD_LINK off, someone with a stored connection can still end it.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () =>
    session.userId ? { id: session.userId, termsVersion: TERMS_VERSION } : null,
  ),
}));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));

import { POST as disconnect } from "@/app/api/robinhood/disconnect/route";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { newAccountKey, sealSecrets } from "./secrets";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: checks what was left behind, across tables");
const post = () =>
  disconnect(new Request("http://localhost/api/robinhood/disconnect", { method: "POST" }));

describe.runIf(url)("disconnecting Robinhood while the connection is switched off", () => {
  const people: string[] = [];

  async function person() {
    const user = await db.user.create({
      data: { email: `rh-off-${crypto.randomUUID()}@example.com` },
    });
    people.push(user.id);
    return user.id;
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    vi.stubEnv("AUTH_URL", "http://localhost:3000");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
  });
  afterAll(async () => {
    await system().user.deleteMany({ where: { id: { in: people } } });
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    vi.stubEnv("ROBINHOOD_LINK", "");
    session.userId = "";
  });
  afterEach(() => vi.restoreAllMocks());

  it("deletes the stored connection and what was read through it, calling no one", async () => {
    const userId = await person();
    const row = await system().robinhoodConnection.create({
      data: {
        userId,
        clientId: "client",
        secretsEncrypted: sealSecrets({
          accessToken: "a",
          refreshToken: "r",
          accountKey: newAccountKey(),
        }),
      },
    });
    await system().account.create({
      data: {
        userId,
        source: "robinhood",
        robinhoodConnectionId: row.id,
        plaidAccountId: `robinhood-${crypto.randomUUID()}`,
        name: "Individual",
        type: "investment",
        currentBalanceCents: 100_00,
      },
    });
    const called = vi.spyOn(globalThis, "fetch");
    session.userId = userId;

    const answer = await post();

    expect(answer.status).toBe(303);
    expect(answer.headers.get("location")).toContain("/investments?robinhood=disconnected");
    expect(await system().robinhoodConnection.count({ where: { userId } })).toBe(0);
    expect(await system().account.count({ where: { userId } })).toBe(0);
    expect(called).not.toHaveBeenCalled();
  });

  it("still isn't there for someone with nothing stored, or signed out", async () => {
    expect((await post()).status).toBe(404);
    session.userId = await person();
    expect((await post()).status).toBe(404);
  });
});
