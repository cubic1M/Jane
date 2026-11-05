import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// The route under load uses the app's default database client, so point it at the
// scratch database before anything imports it.
vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
vi.mock("@/lib/plaid/link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plaid/link")>()),
  createLinkToken: vi.fn(async () => "link-sandbox-1"),
}));

import { RATE_LIMITS } from "@/config/rate-limits";
import { TERMS_VERSION } from "@/config/legal";
import { getCurrentUser } from "@/lib/session";
import { giveBack, hit, hitMany, ipKey } from "./rate-limit";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

// A time in the current minute, never a fixed date: any hit can clear rows more than a day old from a
// database other test files share, and a row dated in the past could go mid-count (62 allowed of 60).
const thisMinuteAt = (seconds: number) => {
  const now = new Date();
  now.setUTCSeconds(seconds, 0);
  return now;
};

describe.runIf(url)("rate limiting against a real database", () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.rateLimit.deleteMany({ where: { key: { contains: "rl-test-" } } });
    await client.$disconnect();
  });

  it("gives a use back, never below zero", async () => {
    const subject = `rl-test-${crypto.randomUUID()}`;
    const now = thisMinuteAt(30);
    await hit("chat", subject, { client, now });
    await hit("chat", subject, { client, now });
    await giveBack("chat", subject, { client, now });
    expect((await hit("chat", subject, { client, now })).remaining).toBe(
      RATE_LIMITS.chat.limit - 2,
    );
    await giveBack("chat", `rl-test-${crypto.randomUUID()}`, { client, now });
  });

  it("allows the limit within a window, then refuses until the next window", async () => {
    const subject = `rl-test-${crypto.randomUUID()}`;
    const now = thisMinuteAt(30);
    const { limit } = RATE_LIMITS.decisions;

    const results = [];
    for (let i = 0; i < limit + 2; i += 1)
      results.push(await hit("decisions", subject, { client, now }));

    expect(results.filter((r) => r.ok)).toHaveLength(limit);
    expect(results.at(-1)).toMatchObject({ ok: false, remaining: 0, retryAfterSeconds: 30 });
    expect(
      (await hit("decisions", subject, { client, now: new Date(now.getTime() + 30_000) })).ok,
    ).toBe(true);
  });

  it("counts correctly under concurrent requests", async () => {
    const subject = `rl-test-${crypto.randomUUID()}`;
    const now = new Date();

    const results = await Promise.all(
      Array.from({ length: 50 }, () => hit("mfa", subject, { client, now })),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(RATE_LIMITS.mfa.limit);
  });

  it("returns 429 under a simple load test on a real route", async () => {
    vi.stubEnv("PLAID_CLIENT_ID", "client");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: `rl-test-${crypto.randomUUID()}`,
      termsVersion: TERMS_VERSION,
    } as never);
    const { POST } = await import("@/app/api/plaid/link-token/route");

    const responses = await Promise.all(
      Array.from({ length: 30 }, () =>
        POST(new Request("http://localhost/api/plaid/link-token", { method: "POST", body: "{}" })),
      ),
    );
    const statuses = responses.map((r) => r.status);

    expect(statuses.filter((s) => s === 200)).toHaveLength(RATE_LIMITS.plaid.limit);
    expect(statuses.filter((s) => s === 429)).toHaveLength(30 - RATE_LIMITS.plaid.limit);
    const refused = responses.find((r) => r.status === 429);
    expect(Number(refused?.headers.get("Retry-After"))).toBeGreaterThan(0);
    vi.unstubAllEnvs();
  });

  it("counts several limits in one round trip, refusing when any one is over", async () => {
    const ip = `rl-test-${crypto.randomUUID()}`;
    const session = `rl-test-${crypto.randomUUID()}`;
    const now = thisMinuteAt(15);
    const checks = [
      { name: "actions" as const, subject: ip },
      { name: "actionsSession" as const, subject: session },
    ];
    const results = [];
    for (let i = 0; i < RATE_LIMITS.actionsSession.limit + 1; i += 1) {
      results.push(await hitMany(checks, { client, now }));
    }
    // The session's limit (the lower) is the one that refuses; both counters went up.
    expect(results.filter((r) => r.ok)).toHaveLength(RATE_LIMITS.actionsSession.limit);
    expect(results.at(-1)).toMatchObject({ ok: false, remaining: 0, retryAfterSeconds: 45 });
    expect((await hit("actions", ip, { client, now })).remaining).toBe(
      RATE_LIMITS.actions.limit - RATE_LIMITS.actionsSession.limit - 2,
    );
    // The same counter twice in one call counts once.
    const twice = await hitMany(
      [
        { name: "api", subject: `${ip}-x` },
        { name: "api", subject: `${ip}-x` },
      ],
      { client, now },
    );
    expect(twice.remaining).toBe(RATE_LIMITS.api.limit - 1);
    expect(await hitMany([], { client, now })).toMatchObject({ ok: true });
  });

  it("makes no new counter for a made-up cookie once its address is refused", async () => {
    const now = thisMinuteAt(30);
    const ip = `flood-${crypto.randomUUID()}`;
    const session = (i: number) => `made-up-${ip}-${i}`;
    const limit = RATE_LIMITS.actions.limit;
    for (let i = 0; i < limit + 5; i += 1) {
      const answer = await hitMany(
        [
          { name: "actions", subject: ip },
          { name: "actionsSession", subject: session(i) },
        ],
        { client, now },
      );
      expect(answer.ok).toBe(i < limit);
    }
    const kept = await client.rateLimit.count({
      where: { key: { contains: `made-up-${ip}` } },
    });
    expect(kept).toBe(limit);
    await client.rateLimit.deleteMany({ where: { key: { contains: ip } } });
  });

  it("hashes IPs instead of storing them", () => {
    const key = ipKey(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("203");
    expect(ipKey(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe(key);
  });
});
