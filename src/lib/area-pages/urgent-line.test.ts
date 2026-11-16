import { describe, expect, it } from "vitest";
import { plansTree, type PlansTreeInput } from "./plans";

// Debugger 11-16 (a student who linked a bank through Plaid sandbox): Home's Loans & credit and
// Plans & goals tiles, and their pages, read "1 urgent · 0 to look at". With nothing else to look
// at, the line is "1 urgent". The seven area trees share the one line.

const input = (deadlines: PlansTreeInput["deadlines"]): PlansTreeInput => ({
  asOf: "2026-11-15",
  deadlines,
  goals: [],
  competing: false,
  netWorth: { todayCents: 401_777, lastMonthCents: 372_807 },
  lifeEvents: { open: 0, newest: null },
  lastMonth: { label: "October" },
  year: 2026,
  yearly: { monthlyCents: 0, bills: 0 },
  debt: { accounts: 0, owedCents: 0 },
});

const due = (key: string, date: string) => ({
  key,
  title: `Card payment ${key}`,
  date,
  kind: "payment" as const,
  amountCents: 3_500,
});

describe("an area's line when something is urgent", () => {
  it("doesn't say there are 0 to look at", () => {
    expect(plansTree(input([due("a", "2026-11-16")])).tree.sub).toBe("1 urgent");
  });

  it("still counts what there is to look at", () => {
    expect(plansTree(input([due("a", "2026-11-16"), due("b", "2026-11-25")])).tree.sub).toBe(
      "1 urgent · 1 to look at",
    );
  });
});
