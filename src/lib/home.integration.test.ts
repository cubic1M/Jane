import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { moneyFound, runDetection } from "@/detection/engine";
import { homeSummary } from "./home";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-15T12:00:00Z");

describe.runIf(url)("home summary against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let emptyId: string;

  beforeAll(async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const suffix = crypto.randomUUID();
    userId = (await client.user.create({ data: { email: `home-${suffix}@example.com` } })).id;
    emptyId = (await client.user.create({ data: { email: `empty-${suffix}@example.com` } })).id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    const day = (d: string) => new Date(`${d}T00:00:00Z`);
    await client.transaction.createMany({
      data: [
        ...["2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15"].map((d) => ({
          userId,
          accountId: account.id,
          source: "csv" as const,
          dedupeKey: `n-${d}`,
          date: day(d),
          amountCents: 1549,
          description: "NETFLIX.COM",
          pfcPrimary: "ENTERTAINMENT",
          pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
          categorySource: "rule" as const,
        })),
        {
          userId,
          accountId: account.id,
          source: "csv" as const,
          dedupeKey: "fee",
          date: day("2026-09-01"),
          amountCents: 3400,
          description: "OVERDRAFT FEE",
          pfcPrimary: "BANK_FEES",
          pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
          categorySource: "rule" as const,
        },
      ],
    });
    await runDetection(userId, { client, now: NOW });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, emptyId] } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("is null for someone without accounts", async () => {
    expect(await homeSummary(emptyId, { client, now: NOW })).toBeNull();
  });

  it("matches the report's numbers and lists the plan and what's coming up", async () => {
    const home = await homeSummary(userId, { client, now: NOW });

    expect(home?.moneyFoundCents).toBe(await moneyFound(userId, { client }));
    expect(home?.savedToDateCents).toBe(0);
    // Spec step 79: the plan card's count and total are /plan's.
    const open = await client.finding.findMany({
      where: { userId, status: { in: ["new", "shown"] } },
      select: { annualSavingsCents: true },
    });
    expect(home?.plan).toEqual({
      items: 2,
      annualSavingsCents: open.reduce((sum, f) => sum + (f.annualSavingsCents ?? 0), 0),
    });
    expect(home?.newToDecide).toBe(2);
    expect(home?.comingUp).toEqual([
      {
        key: "bill:Netflix:2026-11-15",
        date: "2026-11-15",
        label: "Netflix",
        amountCents: 1549,
        daysLeft: 31,
        href: "/bills",
      },
    ]);
    expect(home?.lastUpdated).toBeInstanceOf(Date);
  });

  it("counts only findings not seen yet as new, and lists the person's own deadlines", async () => {
    const [first] = await client.finding.findMany({ where: { userId }, orderBy: { id: "asc" } });
    await client.finding.update({ where: { id: first.id }, data: { status: "shown" } });
    const deadline = await client.deadline.create({
      data: { userId, title: "Use FSA money", dueOn: new Date("2026-10-30"), kind: "fsa" },
    });

    const home = await homeSummary(userId, { client, now: NOW });
    expect(home?.plan.items).toBe(2);
    expect(home?.newToDecide).toBe(1);
    expect(home?.comingUp[0]).toMatchObject({
      label: "Use FSA money",
      amountCents: null,
      daysLeft: 15,
      href: "/deadlines",
    });

    await client.finding.update({ where: { id: first.id }, data: { status: "new" } });
    await client.deadline.delete({ where: { id: deadline.id } });
  });

  it("counts unread alerts, leaving out read ones and types turned off", async () => {
    const base = { userId, title: "t", body: "b" };
    await client.alert.createMany({
      data: [
        { ...base, type: "fee_charged", key: "a" },
        { ...base, type: "fee_charged", key: "b", readAt: NOW },
        { ...base, type: "large_charge", key: "c" },
      ],
    });
    await client.user.update({
      where: { id: userId },
      data: { alertPrefs: { large_charge: "off" } },
    });

    expect((await homeSummary(userId, { client, now: NOW }))?.unreadAlerts).toBe(1);
  });

  it("works out safe to spend from the same budgets and goals the pages show", async () => {
    // Without a checking balance there's nothing to work it out from.
    expect((await homeSummary(userId, { client, now: NOW }))?.safeToSpend).toBeNull();
    await client.account.updateMany({ where: { userId }, data: { currentBalanceCents: 200_000 } });
    await client.budget.create({ data: { userId, category: "Entertainment", amountCents: 5_000 } });
    await client.savingsGoal.create({
      data: { userId, name: "Trip", targetCents: 120_000, targetDate: new Date("2027-10-15") },
    });
    const home = await homeSummary(userId, { client, now: NOW });
    // $50.00 for entertainment, less October's $15.49 Netflix.
    expect(home?.safeToSpend).toMatchObject({
      budgetsLeftCents: 5_000 - 1_549,
      goalsCents: 10_000,
    });
    const safe = home?.safeToSpend;
    expect(safe?.safeCents).toBe(
      (safe?.balanceCents ?? 0) -
        (safe?.billsCents ?? 0) -
        (safe?.budgetsLeftCents ?? 0) -
        (safe?.goalsCents ?? 0),
    );
  });

  it("counts goals only up to what the year plan has room to save this month (books QA)", async () => {
    // A kept plan for October with $60.00 of room after dated payments and extra debt.
    const targets = {
      saving: 0,
      debt: 2_000,
      investing: 0,
      insurance: 1_000,
      taxes: 0,
      deadlines: 1_000,
    };
    const plan = await client.yearPlan.create({
      data: {
        userId,
        startMonth: "2026-10",
        months: [{ month: "2026-10", marginCents: 10_000, targets, actual: null, trimmed: true }],
      },
    });
    const home = await homeSummary(userId, { client, now: NOW });
    // The Trip goal wants $100.00 this month; the plan has room for $60.00.
    expect(home?.safeToSpend?.goalsCents).toBe(6_000);
    await client.yearPlan.delete({ where: { id: plan.id } });
    expect((await homeSummary(userId, { client, now: NOW }))?.safeToSpend?.goalsCents).toBe(10_000);
  });
});
