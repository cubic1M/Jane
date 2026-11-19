import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE, type PersonId } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { cushionSpendCents } from "@/detectors/helpers";
import { formatCents } from "@/lib/money";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadProfileInput } from "@/lib/profile";
import { currentProposals } from "@/lib/proposals";
import { detectFor } from "@/lib/suggestions";
import { cashCushionOf } from "@/planning/idle-cash";
import { monthsOfData } from "@/profile/build";

// Gate B, "one number, one source" (docs/one-number.md): "you spend about $X a month" is one
// figure on the idle cash card, the emergency cushion card and the goal Jane drafts (debug 2's
// re-walk of an old statement, 11-16: one dock said $1,423.98 on idle cash and $1,273.14 on the
// emergency goal). Idle cash counted each account's days to where its statement ends; the cushion
// and the goal took the typical calendar month to today, weeks with nothing in them a quiet month.
// Now all three read idle cash's month (spendingMonthOf, through cushionSpendCents).

const url = process.env.TEST_DATABASE_URL;
// Monday Nov 16, 2026, 9am in Los Angeles.
const NOW = new Date("2026-11-16T17:00:00Z");
const SAID = /spend about (\$[\d,]+\.\d\d) a month/;

describe.runIf(url)("a month of spending, one number", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const user = async (name: string) => {
    const row = await client.user.create({
      data: { email: `one-number-cushion-${name}@example.com`, timezone: "America/Los_Angeles" },
    });
    made.push(row.id);
    return row.id;
  };

  // The month each place works from, and what each card says when it's in the dock.
  const monthOf = async (userId: string) => {
    const o = { client, now: NOW };
    const input = await loadProfileInput(userId, o);
    const idle = cashCushionOf({
      asOf: input.today,
      accounts: input.accounts,
      transactions: input.transactions,
    });
    const { suggestions } = await detectFor(userId, o);
    const said = (topic: string) =>
      SAID.exec(suggestions.find((s) => s.topic === topic)?.why ?? "")?.[1];
    return {
      cushion: cushionSpendCents(input),
      idle: idle?.monthlyCents,
      // The goal Jane drafts (an emergency fund sized from a month of spending), as the chat lists it.
      goal: (await currentProposals(userId, o)).flatMap((p) =>
        "monthlySpendingCents" in p && typeof p.monthlySpendingCents === "number"
          ? [p.monthlySpendingCents]
          : [],
      )[0],
      idleCard: said("idle_cash"),
      cushionCard: said("emergency_fund"),
    };
  };
  const expectOneMonth = async (userId: string) => {
    const m = await monthOf(userId);
    expect(m.cushion).toBeGreaterThan(0);
    const words = formatCents(m.cushion);
    expect(m).toEqual({
      cushion: m.cushion,
      idle: m.idle === undefined ? undefined : m.cushion,
      goal: m.goal === undefined ? undefined : m.cushion,
      idleCard: m.idleCard === undefined ? undefined : words,
      cushionCard: m.cushionCard === undefined ? undefined : words,
    });
    return m;
  };

  it.each(PEOPLE.map((p) => p.id))("%s: one month of spending", async (id) => {
    const userId = await user(id);
    const { itemId } = await linkDemoBank(userId, { client, now: NOW, person: id as PersonId });
    await syncItem(itemId, { client, now: NOW });
    await expectOneMonth(userId);
  });

  it("an old statement's month ends where it does, on every card", async () => {
    const userId = await user("old-statement");
    const { id: accountId } = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 1_500_000,
      },
    });
    // Jul 1 to Oct 20, uploaded Oct 22: rent and groceries each month, read on Nov 16.
    const rows = ["07", "08", "09", "10"].flatMap((m, i) =>
      [
        ["01", 120_000, "RIVERSIDE APTS RENT", "RENT_AND_UTILITIES_RENT"],
        ["12", 21_000 + i * 1_000, "SAFEWAY STORE", "FOOD_AND_DRINK_GROCERIES"],
        ["20", 9_500, "PG&E UTILITY", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"],
      ].map(([day, amountCents, description, pfc], j) => ({
        userId,
        accountId,
        source: "csv" as const,
        dedupeKey: `old-${m}-${j}`,
        date: new Date(`2026-${m}-${day}T00:00:00Z`),
        amountCents: amountCents as number,
        description: description as string,
        pfcPrimary: (pfc as string).startsWith("FOOD_AND_DRINK")
          ? "FOOD_AND_DRINK"
          : "RENT_AND_UTILITIES",
        pfcDetailed: pfc as string,
        pending: false,
        categorySource: "rule" as const,
        createdAt: new Date("2026-10-22T18:00:00Z"),
      })),
    );
    await client.transaction.createMany({ data: rows });
    // $6,080 spent from Jul 1 to Oct 20, where the statement's lines end, over those 111 days:
    // not over the 145 to today, empty weeks read as a quiet month, nor to the day it was uploaded.
    const m = await expectOneMonth(userId);
    expect(m.cushion).toBe(Math.round(608_000 / (111 / 30.4375)));
  });
});
