import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import {
  CHAT_PERSON_DAILY_CAP_CENTS,
  CHAT_MONTHLY_CAP_CENTS_DEFAULT,
  CHAT_PERSON_MONTHLY_CAP_CENTS,
  CHAT_TRIAL_DAILY_CAP_CENTS,
} from "@/config/agent-chat";
import {
  addSpend,
  dailyCapCents,
  overChatLimits,
  overDailyCap,
  overMonthlyPersonCap,
  recordLimitHit,
  spendToday,
} from "./spend";

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
    await client.rateLimit.deleteMany({ where: { key: "trialspend:all" } });
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

  // Beta (11-12): a day's allowance every day was most of everyone's month.
  it("gives a person CHAT_PERSON_MONTHLY_CAP_CENTS a month across days, and starts over on the 1st", async () => {
    const id = await person();
    const day = (d: number) => new Date(`2031-05-${String(d).padStart(2, "0")}T12:00:00Z`);
    const perDay = CHAT_PERSON_DAILY_CAP_CENTS - 1;
    const days = Math.ceil(CHAT_PERSON_MONTHLY_CAP_CENTS / perDay);
    for (let d = 1; d < days; d += 1) {
      await spend(id, perDay, day(d));
      expect(await overMonthlyPersonCap(id, { client, now: day(d) })).toBe(false);
    }
    await spend(id, perDay, day(days));
    // A new day, under its own allowance, but the month's is used up.
    const next = day(days + 1);
    expect(await overDailyCap(id, { client, now: next })).toBe(false);
    expect(await overMonthlyPersonCap(id, { client, now: next })).toBe(true);
    expect(await overChatLimits(id, { client, now: next })).toBe(true);
    expect(await overMonthlyPersonCap(id, { client, now: new Date("2031-06-01T00:00:00Z") })).toBe(
      false,
    );
    // So one person can't spend most of the month for everyone.
    expect(CHAT_PERSON_MONTHLY_CAP_CENTS).toBeLessThanOrEqual(CHAT_MONTHLY_CAP_CENTS_DEFAULT / 4);
  });

  it("never stops an admin's month either", async () => {
    const email = `boss-${crypto.randomUUID()}@example.com`;
    vi.stubEnv("ADMIN_EMAILS", email);
    const admin = await person({ email });
    await spend(admin, CHAT_PERSON_MONTHLY_CAP_CENTS * 2, new Date("2031-07-02T12:00:00Z"));
    const later = new Date("2031-07-03T12:00:00Z");
    expect(await overMonthlyPersonCap(admin, { client, now: later })).toBe(false);
    vi.unstubAllEnvs();
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
    expect(await dailyCapCents(byRole, { client })).toBeNull();
    const email = `founder-${crypto.randomUUID()}@example.com`;
    vi.stubEnv("ADMIN_EMAILS", `someone@example.com, ${email.toUpperCase()}`);
    const byEmail = await person({ email });
    expect(await dailyCapCents(byEmail, { client })).toBeNull();
    await spend(byEmail, CHAT_PERSON_DAILY_CAP_CENTS * 3, at("14:00:00"));
    expect(await overDailyCap(byEmail, { client, now: at("14:00:01") })).toBe(false);
    // Taken off the list, their role alone doesn't keep the allowance.
    expect(await dailyCapCents(byRole, { client })).toBe(CHAT_PERSON_DAILY_CAP_CENTS);
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
