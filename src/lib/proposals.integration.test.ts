import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { cushionSpendCents } from "@/detectors/helpers";
import { loadProfileInput } from "@/lib/profile";
import {
  ProposalError,
  acceptAllProposals,
  answerProposal,
  currentProposals,
  openProposals,
  recentAutoCategories,
  refreshProposals,
} from "./proposals";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T12:00:00Z");

describe.runIf(url)("set-up proposals against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const merchantKeys: string[] = [];

  // Three months of groceries and a merchant the directory knows but the person's data
  // has no category for.
  // "Ask me first" by default here, so nothing is applied on its own (step 63 is tested
  // below with another level).
  async function person(autopilot: "ask" | "safe" = "ask") {
    const user = await client.user.create({
      data: { email: `proposals-${crypto.randomUUID()}@example.com`, autopilot },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    // Letters only (they survive normalization), random enough never to repeat.
    const merchant = `Zz${Array.from({ length: 14 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("")}tools`;
    merchantKeys.push(merchant.toLowerCase());
    await client.merchant.create({
      data: {
        key: merchant.toLowerCase(),
        name: merchant,
        category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      },
    });
    const tx = (date: string, cents: number, description: string, categorized: boolean) => ({
      userId: user.id,
      accountId: account.id,
      source: "csv" as const,
      dedupeKey: crypto.randomUUID(),
      date: new Date(`${date}T00:00:00Z`),
      amountCents: cents,
      description,
      ...(categorized
        ? {
            pfcPrimary: "FOOD_AND_DRINK",
            pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
            categorySource: "rule" as const,
          }
        : {}),
    });
    await client.transaction.createMany({
      data: [
        ...["2026-07-10", "2026-08-10", "2026-09-10"].map((d) =>
          tx(d, 45_000, "WHOLEFDS MKT", true),
        ),
        tx("2026-09-03", 1_499, merchant.toUpperCase(), false),
        tx("2026-10-03", 1_499, merchant.toUpperCase(), false),
      ],
    });
    return { userId: user.id, merchant };
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.merchant.deleteMany({ where: { key: { in: merchantKeys } } });
    await client.$disconnect();
  });

  // Debugger 11-04: "a cushion for you is $19,072.86" beside an "Emergency fund" goal of $20,700. The
  // goal read a few months, where a bill paid twice a year looks like a usual one; the card read a year.
  it("sizes the goal from the same month as the cushion card, with a bill paid twice a year", async () => {
    const user = await client.user.create({
      data: { email: `proposals-${crypto.randomUUID()}@example.com`, autopilot: "ask" },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    const row = (
      date: string,
      cents: number,
      description: string,
      primary: string,
      detailed: string,
    ) => ({
      userId: user.id,
      accountId: account.id,
      source: "csv" as const,
      dedupeKey: crypto.randomUUID(),
      date: new Date(`${date}T00:00:00Z`),
      amountCents: cents,
      description,
      pfcPrimary: primary,
      pfcDetailed: detailed,
      categorySource: "rule" as const,
    });
    const months = [
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ];
    await client.transaction.createMany({
      data: [
        ...months.map((m) =>
          row(`${m}-10`, 300_000, "WHOLEFDS MKT", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
        ),
        ...["2026-03-22", "2026-09-22"].map((d) =>
          row(
            d,
            312_075,
            "MECKLENBURG CO PROPERTY TAX",
            "GOVERNMENT_AND_NON_PROFIT",
            "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
          ),
        ),
      ],
    });
    const goal = (await currentProposals(user.id, { client, now: NOW })).find(
      (p) => p.key === "goal:emergency_fund",
    );
    const data = await loadProfileInput(user.id, { client, now: NOW });
    expect(goal).toMatchObject({ monthlySpendingCents: cushionSpendCents(data, 12) });
  });

  it("proposes from the person's numbers and creates nothing until they say yes", async () => {
    const { userId, merchant } = await person();
    await refreshProposals(userId, { client, now: NOW });
    const open = await openProposals(userId, { client });
    expect(open.map((p) => p.key).sort()).toEqual(
      ["budget:Food and drink", `category:${merchant.toLowerCase()}`, "goal:emergency_fund"].sort(),
    );
    expect(open.find((p) => p.kind === "budget")).toMatchObject({ amountCents: 45_000 });
    expect(await client.budget.count({ where: { userId } })).toBe(0);
    expect(await client.savingsGoal.count({ where: { userId } })).toBe(0);
  });

  it("sets up what the person says yes to, with their changes", async () => {
    const { userId, merchant } = await person();
    await refreshProposals(userId, { client, now: NOW });
    await answerProposal(
      userId,
      "budget:Food and drink",
      true,
      { amount: "400" },
      { client, now: NOW },
    );
    await answerProposal(
      userId,
      "goal:emergency_fund",
      true,
      { date: "2027-06-01" },
      { client, now: NOW },
    );
    await answerProposal(
      userId,
      `category:${merchant.toLowerCase()}`,
      true,
      {},
      { client, now: NOW },
    );

    expect(await client.budget.findFirstOrThrow({ where: { userId } })).toMatchObject({
      category: "Food and drink",
      amountCents: 40_000,
    });
    const goal = await client.savingsGoal.findFirstOrThrow({ where: { userId } });
    expect(goal).toMatchObject({ name: "Emergency fund" });
    expect(goal.targetDate.toISOString().slice(0, 10)).toBe("2027-06-01");
    expect(
      await client.transaction.count({
        where: { userId, pfcDetailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES" },
      }),
    ).toBe(2);
    expect(await openProposals(userId, { client })).toEqual([]);
    await expect(
      answerProposal(userId, "budget:Food and drink", true, {}, { client }),
    ).rejects.toBeInstanceOf(ProposalError);
  });

  it("doesn't bring back what the person said no to", async () => {
    const { userId } = await person();
    await refreshProposals(userId, { client, now: NOW });
    await answerProposal(userId, "goal:emergency_fund", false, {}, { client, now: NOW });
    await refreshProposals(userId, { client, now: NOW });
    expect((await openProposals(userId, { client })).some((p) => p.kind === "goal")).toBe(false);
    expect(await client.savingsGoal.count({ where: { userId } })).toBe(0);
  });

  it("refuses a change that doesn't make sense, and keeps the proposal open", async () => {
    const { userId } = await person();
    await refreshProposals(userId, { client, now: NOW });
    await expect(
      answerProposal(userId, "budget:Food and drink", true, { amount: "lots" }, { client }),
    ).rejects.toBeInstanceOf(ProposalError);
    expect((await openProposals(userId, { client })).some((p) => p.kind === "budget")).toBe(true);
  });

  it("files directory categories on its own unless the person asks first", async () => {
    const { userId, merchant } = await person("safe");
    await refreshProposals(userId, { client, now: NOW });
    expect((await openProposals(userId, { client })).some((p) => p.kind === "category")).toBe(
      false,
    );
    expect(
      await client.transaction.count({
        where: { userId, pfcDetailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES" },
      }),
    ).toBe(2);
    expect(await recentAutoCategories(userId, { client, now: NOW })).toEqual([
      { merchantName: merchant, detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES" },
    ]);
    // Budgets and the goal still wait, then go in one tap.
    expect(await client.budget.count({ where: { userId } })).toBe(0);
    expect(await acceptAllProposals(userId, { client, now: NOW })).toBe(2);
    expect(await client.budget.count({ where: { userId } })).toBe(1);
    expect(await client.savingsGoal.count({ where: { userId } })).toBe(1);
  });
});
