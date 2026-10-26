import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { CHAT_PERSON_DAILY_CAP_CENTS, CHAT_TRIAL_DAILY_CAP_CENTS } from "@/config/agent-chat";
import { addSpend, dailyCapCents, overDailyCap, recordLimitHit, spendToday } from "./spend";

// Founder (2026-10-26): a per-person daily allowance for Claude's written answers, so one
// person can't use up the month. Against a real, migrated Postgres: the limits, the reset at
// midnight UTC, the admin exemption, and the founder's count of limit hits. No Claude calls:
// spend is added as if an answer had cost it.

const url = process.env.TEST_DATABASE_URL;
// A day of its own, so other tests' spend never lands in the totals.
const DAY = "2031-03-04";
const at = (time: string) => new Date(`${DAY}T${time}Z`);
const NEXT_MIDNIGHT = new Date("2031-03-05T00:00:00Z");
const MODEL = "claude-sonnet-5-5";

describe.runIf(url)("a person's daily allowance of written answers", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person({
    role = "user",
    email,
    id,
  }: { role?: "user" | "admin"; email?: string; id?: string } = {}) {
    const user = await client.user.create({
      data: { id, role, email: email ?? `spend-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }

  // Spends a little more than `cents` for the person at `now`.
  async function spend(userId: string, cents: number, now: Date) {
    const { MODEL_PRICES_CENTS } = await import("@/config/answer-checks");
    const perMillion = MODEL_PRICES_CENTS[MODEL].output;
    const outputTokens = Math.ceil((cents * 1_000_000) / perMillion) + 1;
    await addSpend(userId, { model: MODEL, inputTokens: 0, outputTokens }, { client, now });
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    // The months of their own these tests spent in.
    await client.rateLimit.deleteMany({
      where: { key: "chatmonth:total", windowStart: { gte: new Date("2031-01-01T00:00:00Z") } },
    });
    for (const id of created) {
      await client.rateLimit.deleteMany({ where: { key: { endsWith: `:${id}` } } });
    }
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("gives a person CHAT_PERSON_DAILY_CAP_CENTS and stops at it", async () => {
    const id = await person();
    expect(await dailyCapCents(id, { client })).toBe(CHAT_PERSON_DAILY_CAP_CENTS);
    await spend(id, CHAT_PERSON_DAILY_CAP_CENTS - 2, at("10:00:00"));
    expect(await overDailyCap(id, { client, now: at("10:00:01") })).toBe(false);
    await spend(id, 2, at("10:05:00"));
    expect(await overDailyCap(id, { client, now: at("10:05:01") })).toBe(true);
  });

  it("starts the allowance over at midnight UTC", async () => {
    const id = await person();
    await spend(id, CHAT_PERSON_DAILY_CAP_CENTS, at("23:59:58"));
    expect(await overDailyCap(id, { client, now: at("23:59:59") })).toBe(true);
    expect(await overDailyCap(id, { client, now: NEXT_MIDNIGHT })).toBe(false);
    // The new day has the whole allowance.
    await spend(id, CHAT_PERSON_DAILY_CAP_CENTS / 2, NEXT_MIDNIGHT);
    expect(await overDailyCap(id, { client, now: NEXT_MIDNIGHT })).toBe(false);
  });

  it("gives a sample person their own limit", async () => {
    const id = await person({
      id: `trial_spend${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
      email: `trial-spend-${crypto.randomUUID()}@try.jane.invalid`,
    });
    expect(await dailyCapCents(id, { client })).toBe(CHAT_TRIAL_DAILY_CAP_CENTS);
    await spend(id, CHAT_PERSON_DAILY_CAP_CENTS, at("12:00:00"));
    expect(await overDailyCap(id, { client, now: at("12:00:01") })).toBe(false);
    await spend(id, CHAT_TRIAL_DAILY_CAP_CENTS, at("12:01:00"));
    expect(await overDailyCap(id, { client, now: at("12:01:01") })).toBe(true);
  });

  it("never stops an admin, by role or by ADMIN_EMAILS", async () => {
    const byRole = await person({ role: "admin" });
    const email = `founder-${crypto.randomUUID()}@example.com`;
    vi.stubEnv("ADMIN_EMAILS", `someone@example.com, ${email.toUpperCase()}`);
    const byEmail = await person({ email });
    for (const id of [byRole, byEmail]) {
      expect(await dailyCapCents(id, { client })).toBeNull();
      await spend(id, CHAT_PERSON_DAILY_CAP_CENTS * 3, at("14:00:00"));
      expect(await overDailyCap(id, { client, now: at("14:00:01") })).toBe(false);
    }
    vi.unstubAllEnvs();
    // Off the list and not an admin: the limit again.
    expect(await overDailyCap(byEmail, { client, now: at("14:00:01") })).toBe(true);
  });

  it("counts today's spend and the limit hits for the founder, never a sample person's hits", async () => {
    const day = new Date("2031-04-09T09:00:00Z");
    const before = await spendToday({ client, now: day });
    const one = await person();
    const two = await person();
    const sample = await person({
      id: `trial_hits${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
      email: `trial-hits-${crypto.randomUUID()}@try.jane.invalid`,
    });
    await spend(one, 5, day);
    await spend(two, 3, day);
    await spend(sample, 4, day);
    await recordLimitHit(one, { client, now: day });
    await recordLimitHit(one, { client, now: day });
    await recordLimitHit(sample, { client, now: day });
    // Yesterday's hit isn't today's.
    await recordLimitHit(two, { client, now: new Date("2031-04-08T23:59:59Z") });
    const today = await spendToday({ client, now: day });
    expect(today.people - before.people).toBe(2);
    expect(today.peopleAtLimit - before.peopleAtLimit).toBe(1);
    expect(today.limitHits - before.limitHits).toBe(2);
    expect(today.spentCents - before.spentCents).toBeGreaterThan(12);
    expect(today.sampleCents - before.sampleCents).toBeGreaterThan(4);
    expect(today.sampleCents - before.sampleCents).toBeLessThan(5);
    // The month's total counts it all, and the cap is the configured one.
    expect(today.monthSpentCents - before.monthSpentCents).toBeGreaterThan(12);
    expect(today.personCapCents).toBe(CHAT_PERSON_DAILY_CAP_CENTS);
  });
});
