import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { LIVE_NOTICE_MIN_ANNUAL_CENTS } from "@/config/detection";
import { linkDemoBank } from "@/lib/plaid/demo";
import { recordArrivals } from "./arrivals";

// The 24/7 engine's notice rules, one by one, against a real Postgres (test pass 11-13): the $100
// floor and medium confidence exactly at their edges, quiet hours on the person's own clock on both
// sides of UTC midnight, one a day as a rolling day (not a UTC one), never mid-chat or on the demo
// bank, and two scans at once (two banks' webhooks, or one delivered twice) telling at most one.

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3_600_000;

describe.runIf(url)("when the 24/7 engine tells someone", () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function person(timezone = "America/Los_Angeles") {
    const user = await client.user.create({
      data: { email: `rules-${crypto.randomUUID()}@example.com`, timezone },
    });
    made.push(user.id);
    await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    return user.id;
  }

  let n = 0;
  async function finding(
    userId: string,
    annualSavingsCents: number,
    confidence: "low" | "medium" | "high" = "high",
  ) {
    const key = `rule${(n++).toString(36)}`;
    await client.finding.create({
      data: {
        userId,
        type: "subscription_review",
        key,
        title: `Review your ${key} subscription`,
        annualSavingsCents,
        amountCents: annualSavingsCents,
        confidence,
        evidence: { merchant: key },
      },
    });
    return { type: "subscription_review" as const, key };
  }

  // One new finding at `at`, set off by a webhook then; what was decided about telling them.
  async function arrive(userId: string, at: Date, cents = 48_000, confidence?: "low" | "medium") {
    await recordArrivals(userId, [await finding(userId, cents, confidence)], {
      client,
      now: at,
      trigger: "webhook",
      triggerAt: at,
      foundAt: at,
    });
    const last = await client.findingArrival.findFirstOrThrow({
      where: { userId },
      orderBy: { foundAt: "desc" },
    });
    return last.notice;
  }

  it("tells at $100 a year and medium confidence, not a cent or a step below", async () => {
    // 10am in Los Angeles, a day apart each so the daily cap never decides.
    const day = (d: number) => new Date(Date.UTC(2026, 10, 2 + d, 18));
    const p = await person();
    expect(await arrive(p, day(0), LIVE_NOTICE_MIN_ANNUAL_CENTS - 1)).toBe("below_bar");
    expect(await arrive(p, day(1), LIVE_NOTICE_MIN_ANNUAL_CENTS)).toBe("posted");
    expect(await arrive(p, day(3), 80_000, "low")).toBe("below_bar");
    expect(await arrive(p, day(5), 80_000, "medium")).toBe("posted");
  });

  it("keeps quiet hours on the person's own clock, whatever the hour in UTC", async () => {
    // Tokyo at 12:30 UTC is 9:30pm: quiet, though it's midday in UTC.
    const tokyo = await person("Asia/Tokyo");
    expect(await arrive(tokyo, new Date("2026-11-12T12:30:00Z"))).toBe("quiet_hours");
    // Kolkata, either side of UTC midnight, is 5:20am and 5:40am: quiet both times.
    const kolkata = await person("Asia/Kolkata");
    expect(await arrive(kolkata, new Date("2026-11-12T23:50:00Z"))).toBe("quiet_hours");
    expect(await arrive(kolkata, new Date("2026-11-13T00:10:00Z"))).toBe("quiet_hours");
    // 8:10am there: told.
    expect(await arrive(kolkata, new Date("2026-11-13T02:40:00Z"))).toBe("posted");
    // Los Angeles at 8:59pm and 9:01pm local (04:59 and 05:01 UTC).
    const evening = await person();
    expect(await arrive(evening, new Date("2026-11-13T04:59:00Z"))).toBe("posted");
    expect(await arrive(evening, new Date("2026-11-13T05:01:00Z"))).toBe("quiet_hours");
  });

  it("counts one a day as a rolling day: a new UTC date or local date doesn't reset it", async () => {
    // 3:50pm and 4:10pm in Los Angeles, either side of UTC midnight.
    const la = await person();
    expect(await arrive(la, new Date("2026-11-12T23:50:00Z"))).toBe("posted");
    expect(await arrive(la, new Date("2026-11-13T00:10:00Z"))).toBe("today_used");
    // 8:30pm, then 8:30am the next local day: still inside 24 hours of the last one told.
    const late = await person();
    expect(await arrive(late, new Date("2026-11-13T04:30:00Z"))).toBe("posted");
    expect(await arrive(late, new Date("2026-11-13T16:30:00Z"))).toBe("today_used");
    expect(await arrive(late, new Date("2026-11-14T04:31:00Z"))).toBe("posted");
  });

  it("waits while they're typing to Jane, and never tells the demo bank", async () => {
    const at = new Date("2026-11-12T18:00:00Z");
    const typing = await person();
    await client.janeMessage.create({
      data: {
        userId: typing,
        kind: "user",
        body: "is my gym worth it",
        dedupeKey: `user:${crypto.randomUUID()}`,
        createdAt: new Date(at.getTime() - 60_000),
      },
    });
    expect(await arrive(typing, at)).toBe("chatting");
    // Long after they stopped typing, it's told.
    expect(await arrive(typing, new Date(at.getTime() + 2 * HOUR))).toBe("posted");

    const demo = await person();
    await linkDemoBank(demo, { client, now: at });
    expect(await arrive(demo, at)).toBe("demo");
    expect(await client.janeMessage.count({ where: { userId: demo } })).toBe(0);
  });

  it("tells one, once, when two scans run at the same moment", async () => {
    const at = new Date("2026-11-12T18:00:00Z");
    const userId = await person();
    // Two banks' webhooks, each scan with its own new finding.
    const a = await finding(userId, 60_000);
    const b = await finding(userId, 70_000);
    // And one delivery handled twice over the same finding.
    const c = await finding(userId, 90_000);
    const run = (created: { type: "subscription_review"; key: string }[]) =>
      recordArrivals(userId, created, { client, now: at, trigger: "webhook", triggerAt: at });
    await Promise.all([run([a]), run([b]), run([c]), run([c])]);
    const rows = await client.findingArrival.findMany({ where: { userId } });
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.notice === "posted")).toHaveLength(1);
    const decisions = await client.janeMessage.count({ where: { userId, kind: "decision" } });
    expect(decisions).toBeLessThanOrEqual(1);
    const jobs = await client.job.count({
      where: { kind: "chat_notify", payload: { equals: { userId } } },
    });
    expect(jobs).toBeLessThanOrEqual(1);
  });
});
