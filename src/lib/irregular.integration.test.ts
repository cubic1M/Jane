import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { homeSummary } from "./home";
import { irregularCosts } from "./irregular";
import { acceptAllProposals, answerProposal, openProposals, refreshProposals } from "./proposals";

// Saving for irregular costs (spec step 70), against a real, migrated Postgres (see
// src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T12:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe.runIf(url)("irregular costs against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  // Quarterly Duolingo on the card, a yearly DMV bill from checking, and a quarterly
  // charge on a car loan (which never counts).
  async function person() {
    const user = await client.user.create({
      data: { email: `irregular-${crypto.randomUUID()}@example.com`, autopilot: "ask" },
    });
    created.push(user.id);
    const account = (name: string, type: string, subtype: string, balance: number | null) =>
      client.account.create({
        data: { userId: user.id, source: "csv", name, type, subtype, currentBalanceCents: balance },
      });
    const checking = await account("Checking", "depository", "checking", 300_000);
    const card = await account("Card", "credit", "credit card", 50_000);
    const loan = await account("Car loan", "loan", "auto", 1_800_000);
    const tx = (
      accountId: string,
      date: string,
      cents: number,
      description: string,
      merchantName: string,
      pfcDetailed: string,
    ) => ({
      userId: user.id,
      accountId,
      source: "csv" as const,
      dedupeKey: crypto.randomUUID(),
      date: day(date),
      amountCents: cents,
      description,
      merchantName,
      pfcPrimary: pfcDetailed.startsWith("GOVERNMENT")
        ? "GOVERNMENT_AND_NON_PROFIT"
        : "GENERAL_SERVICES",
      pfcDetailed,
      categorySource: "rule" as const,
    });
    await client.transaction.createMany({
      data: [
        ...["2025-10-22", "2026-01-21", "2026-04-21", "2026-07-21"].map((d) =>
          tx(card.id, d, 2_999, "DUOLINGO PLUS", "Duolingo", "GENERAL_SERVICES_EDUCATION"),
        ),
        tx(
          checking.id,
          "2026-05-21",
          21_200,
          "CA DMV VEHICLE REGISTRATION",
          "California DMV",
          "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES",
        ),
        ...["2025-11-05", "2026-02-05", "2026-05-05", "2026-08-05"].map((d) =>
          tx(loan.id, d, 30_000, "GAP COVERAGE", "Gap Coverage", "GENERAL_SERVICES_INSURANCE"),
        ),
      ],
    });
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("finds the quarterly and yearly bills, and nothing from the loan", async () => {
    const userId = await person();
    const costs = await irregularCosts(userId, { client, now: NOW });
    expect(costs.items.map((i) => [i.name, i.frequency, i.yearlyCents, i.nextDate])).toEqual([
      ["Duolingo", "QUARTERLY", 11_996, "2026-10-21"],
      ["California DMV", "ANNUALLY", 21_200, "2027-05-21"],
    ]);
    // $10 + $18 a month.
    expect(costs.monthlyCents).toBe(2_800);
  });

  it("only reads the person's own data", async () => {
    await person();
    const someoneElse = await client.user.create({
      data: { email: `irregular-${crypto.randomUUID()}@example.com` },
    });
    created.push(someoneElse.id);
    expect(await irregularCosts(someoneElse.id, { client, now: NOW })).toEqual({
      items: [],
      monthlyCents: 0,
      yearlyCents: 0,
    });
  });

  it("takes this month's set-aside off safe to spend", async () => {
    const userId = await person();
    const safe = (await homeSummary(userId, { client, now: NOW }))?.safeToSpend;
    expect(safe?.setAsideCents).toBe(2_800);
    expect(safe?.safeCents).toBe(
      (safe?.balanceCents ?? 0) -
        (safe?.billsCents ?? 0) -
        (safe?.budgetsLeftCents ?? 0) -
        (safe?.goalsCents ?? 0) -
        2_800,
    );
  });

  it("proposes a Yearly bills goal, and yes creates it", async () => {
    const userId = await person();
    await refreshProposals(userId, { client, now: NOW });
    const proposal = (await openProposals(userId, { client })).find(
      (p) => p.key === "goal:yearly_bills",
    );
    expect(proposal).toMatchObject({
      kind: "goal",
      name: "Yearly bills",
      targetCents: 2_800 * 12,
      targetDate: "2027-10-18",
      monthlySetAsideCents: 2_800,
    });
    await answerProposal(userId, "goal:yearly_bills", true, {}, { client, now: NOW });
    const goal = await client.savingsGoal.findFirstOrThrow({ where: { userId } });
    expect(goal).toMatchObject({ name: "Yearly bills", targetCents: 33_600 });
    expect(goal.targetDate.toISOString().slice(0, 10)).toBe("2027-10-18");

    // Once they have the goal, safe to spend counts the set-aside once, not twice.
    const safe = (await homeSummary(userId, { client, now: NOW }))?.safeToSpend;
    expect(safe).toMatchObject({ setAsideCents: 2_800, goalsCents: 0 });
  });

  it("is part of Use Jane's suggestions", async () => {
    const userId = await person();
    await refreshProposals(userId, { client, now: NOW });
    await acceptAllProposals(userId, { client, now: NOW });
    expect(await client.savingsGoal.count({ where: { userId, name: "Yearly bills" } })).toBe(1);
  });

  it("remembers a no, and proposes nothing to someone who has such a goal", async () => {
    const userId = await person();
    await refreshProposals(userId, { client, now: NOW });
    await answerProposal(userId, "goal:yearly_bills", false, {}, { client, now: NOW });
    await refreshProposals(userId, { client, now: NOW });
    expect(
      (await openProposals(userId, { client })).some((p) => p.key === "goal:yearly_bills"),
    ).toBe(false);
    expect(await client.savingsGoal.count({ where: { userId } })).toBe(0);

    const saver = await person();
    await client.savingsGoal.create({
      data: {
        userId: saver,
        name: "Annual bills pot",
        targetCents: 50_000,
        targetDate: day("2027-06-01"),
      },
    });
    await refreshProposals(saver, { client, now: NOW });
    expect(
      (await openProposals(saver, { client })).some((p) => p.key === "goal:yearly_bills"),
    ).toBe(false);
  });
});
