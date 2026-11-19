import { describe, expect, it } from "vitest";
import { owedTotals } from "./invariants";

// The owed-totals rule (class 8, debug3-invariants.md).

const debts = "trees.loans.tree.branches.debts.items";
const loans = (overrides: Record<string, unknown> = {}) => ({
  "tiles.loans.value": "$23k",
  "tiles.loans.caption": "Owed on 4 accounts",
  [`${debts}.debts:account:a.figure`]: "$4.7k at 29.99%",
  [`${debts}.debts:account:a.line`]: "Credit card",
  [`${debts}.debts:account:b.line`]: "Credit card",
  [`${debts}.debts:account:c.line`]: "Credit card",
  [`${debts}.debts:account:d.line`]: "Car loan",
  [`${debts}.debts:account:b.figure`]: "$3.9k at 27.99%",
  [`${debts}.debts:account:c.figure`]: "$1.5k at 31.99%",
  [`${debts}.debts:account:d.figure`]: "$13k at 17.90%",
  [`${debts}.debts:due.figure`]: "2 in the next month",
  ...overrides,
});
const comingUp = (body: string) => ({
  "chat.what bills are coming up.body": body,
  "home.summary.comingUp.r1.kind": "return",
  "home.summary.comingUp.r1.amountCents": 50_000,
  "home.summary.comingUp.b1.kind": "bill",
  "home.summary.comingUp.b1.amountCents": 12_000,
  "home.summary.comingUp.p1.kind": "payment",
  "home.summary.comingUp.p1.amountCents": 3_500,
});

describe("what's added up as owed", () => {
  it("holds when the tile is its debts added up and counted", () => {
    expect(owedTotals(loans())).toEqual([]);
    expect(
      owedTotals(
        loans({
          "tiles.loans.caption": "Owed on 4 of 5 accounts",
          [`${debts}.debts:bnpl:e.figure`]: "Not known",
          [`${debts}.debts:bnpl:e.line`]: "Buy now, pay later",
        }),
      ),
    ).toEqual([]);
  });

  it("catches a tile that isn't its debts", () => {
    expect(owedTotals(loans({ "tiles.loans.value": "$28k" }))).toHaveLength(1);
    expect(owedTotals(loans({ "tiles.loans.caption": "Owed on 5 accounts" }))).toHaveLength(1);
  });

  it("catches a return window's purchase counted as owed (#2043)", () => {
    expect(owedTotals(comingUp("3 things are coming up, $155.00 in all."))).toEqual([]);
    expect(owedTotals(comingUp("3 things are coming up, $655.00 in all."))).toHaveLength(1);
  });
});
