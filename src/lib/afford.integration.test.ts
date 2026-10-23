import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { PEOPLE } from "@/config/people";
import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";
import { affordCheck, affordWindow } from "@/planning/afford";
import { project } from "@/planning/what-if";
import { loadAffordNumbers } from "./afford";
import { homeSummary } from "./home";
import { loadBaseline } from "./what-if";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-20T12:00:00Z");

describe.runIf(url)("can-I-afford-this numbers against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let emptyId: string;

  beforeAll(async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const suffix = crypto.randomUUID();
    userId = (await client.user.create({ data: { email: `afford-${suffix}@example.com` } })).id;
    emptyId = (await client.user.create({ data: { email: `afford0-${suffix}@example.com` } })).id;
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 200_000,
      },
    });
    // Netflix on the 15th of each month: a regular bill from checking.
    await client.transaction.createMany({
      data: ["2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15"].map((d) => ({
        userId,
        accountId: account.id,
        source: "csv" as const,
        dedupeKey: `n-${d}`,
        date: new Date(`${d}T00:00:00Z`),
        amountCents: 1549,
        description: "NETFLIX.COM",
        pfcPrimary: "ENTERTAINMENT",
        pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
        categorySource: "rule" as const,
      })),
    });
    await client.savingsGoal.create({
      data: {
        userId,
        name: "Trip",
        targetCents: 120_000,
        manualSavedCents: 0,
        targetDate: new Date("2027-10-20T00:00:00Z"),
      },
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, emptyId] } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("uses Home's safe to spend, the checking bills ahead and the goals", async () => {
    const [numbers, home] = await Promise.all([
      loadAffordNumbers(userId, { client, now: NOW }),
      homeSummary(userId, { client, now: NOW }),
    ]);
    expect(numbers.asOf).toBe("2026-10-20");
    expect(numbers.safe).toEqual({
      payday: home?.safeToSpend?.payday,
      balanceCents: 200_000,
      safeCents: home?.safeToSpend?.safeCents,
    });
    // Netflix from Nov 15, 2026 through Sep 15, 2027: the last month shown.
    expect(numbers.flows).toHaveLength(11);
    expect(numbers.flows[0]).toEqual({ date: "2026-11-15", amountCents: -1549 });
    // Netflix is all they spend, and it's a regular bill: no everyday spending besides it.
    expect(numbers.everydayMonthlyCents).toBe(0);
    expect(numbers.goals).toEqual([
      expect.objectContaining({ name: "Trip", targetCents: 120_000, savedCents: 0 }),
    ]);

    const result = affordCheck(numbers, {
      kind: "purchase",
      amountCents: 10_000,
      date: "2026-10-20",
    });
    expect(result.months?.[11]).toEqual({
      month: "2027-09",
      beforeCents: 200_000 - 11 * 1549,
      afterCents: 190_000 - 11 * 1549,
    });
  });

  it("has no checking numbers for someone without accounts", async () => {
    expect(await loadAffordNumbers(emptyId, { client, now: NOW })).toEqual({
      asOf: "2026-10-20",
      everydayMonthlyCents: 0,
      safe: null,
      flows: [],
      goals: [],
    });
  });
});

// "Can I afford a car at $850 a month?" (docs/feature-audit.md, cluster 11) on the eight sample
// people: /afford counts the same everyday spending as What if, so What if never says cash runs
// out while /afford says checking is fine. /afford starts from checking alone and What if from all
// cash, so /afford may run short first, never later.
describe.runIf(url)("/afford and What if agree on the eight sample people", () => {
  let client: PrismaClient;
  const made: string[] = [];
  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it.each(PEOPLE.map((p) => p.id))("%s", { timeout: 120_000 }, async (id) => {
    const trial = await startTrial({ client, now: NOW, defer: true, person: id });
    made.push(trial.userId);
    await syncItem(trial.itemId, { client, now: NOW });
    const numbers = await loadAffordNumbers(trial.userId, { client, now: NOW });
    const afford = affordCheck(numbers, {
      kind: "monthly",
      amountCents: 85_000,
      startMonth: "2026-11",
    });
    const baseline = (await loadBaseline(trial.userId, { client, now: NOW }))!;
    const whatIf = project(baseline, {
      incomeLossShare: 0,
      months: 0,
      extraMonthlyCents: 85_000,
      savedMonthlyCents: 0,
      oneTimeCents: 0,
    });
    // What if's month 1 is November; /afford's months start with October.
    const runsOut =
      whatIf.runsOutMonth !== null && whatIf.runsOutMonth <= 11
        ? affordWindow("2026-10-20").months[whatIf.runsOutMonth]
        : null;
    if (runsOut && numbers.safe) {
      expect(afford.firstShort?.after, `${id}: What if runs out in ${runsOut}`).not.toBeNull();
      expect(afford.firstShort!.after! <= runsOut).toBe(true);
    }
  });
});
