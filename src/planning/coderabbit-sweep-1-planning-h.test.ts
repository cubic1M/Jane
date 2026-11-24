import { describe, expect, it } from "vitest";
import type { HoldingView, InvestmentAccountView } from "@/insights/investments";
import { asWatch } from "./outcomes";
import { ownedFacts } from "./owned-facts";
import { panicSells } from "./panic-sells";

// CodeRabbit sweep, part 1 (money figures), src/planning chunk 6 (second look, in halves): each
// case is a finding reproduced against the code first (failing), then fixed.

describe("a stored savings watch", () => {
  it("reads back a cash_moved watch that was written", () => {
    const w = { kind: "cash_moved", accountIds: ["a1"], amountCents: 500_000 };
    expect(asWatch(w)).toEqual(w);
  });
  it("rejects a cash_moved watch with nothing in it", () => {
    expect(asWatch({ kind: "cash_moved", accountIds: [], amountCents: 500_000 })).toBeNull();
    expect(asWatch({ kind: "cash_moved", accountIds: ["a1"], amountCents: 0 })).toBeNull();
  });
  it("rejects payees that aren't payees", () => {
    expect(asWatch({ kind: "refund", payees: [null] })).toBeNull();
    expect(asWatch({ kind: "refund", payees: [{ description: "ACME" }] })).not.toBeNull();
  });
});

describe("sales at a loss that the price then recovered from", () => {
  const sale = { ticker: "ABC", date: "2026-03-10", quantity: 10, priceCents: 8_000 };
  const bar = (date: string, closeCents: number) => ({ date, closeCents });
  it("doesn't take the sale day's own close for the high it fell from", () => {
    // A morning sale at $80; every close before it was $85 or less; it closed at $100 that day.
    const bars = [bar("2026-03-05", 8_500), bar("2026-03-10", 10_000), bar("2026-03-20", 9_000)];
    expect(panicSells([sale], { ABC: bars }).sales).toEqual([]);
  });
  it("values the shares at the latest close even when the bars come newest first", () => {
    const bars = [bar("2026-03-20", 9_000), bar("2026-03-05", 12_000)];
    const out = panicSells([sale], { ABC: bars }).sales;
    expect(out).toHaveLength(1);
    expect(out[0]!.worthTodayCents).toBe(90_000);
  });
});

describe("what a person owns", () => {
  const hold = (id: string, accountId: string, ticker: string | null, valueCents: number) =>
    ({
      id,
      accountId,
      name: ticker ?? id,
      ticker,
      type: "equity",
      isCash: false,
      quantity: 1,
      priceCents: valueCents,
      valueCents,
      costBasisCents: null,
      gainCents: null,
      expenseRatioBps: null,
      category: null,
      mix: { us_stocks: 1 },
      source: "x",
      factsSource: null,
    }) as HoldingView;
  const account = (id: string, holdings: HoldingView[]): InvestmentAccountView =>
    ({ id, name: id, holdings }) as unknown as InvestmentAccountView;
  it("adds one stock held in two accounts into one position", () => {
    const f = ownedFacts([
      account("a", [hold("h1", "a", "ABC", 400_000), hold("h3", "a", "XYZ", 600_000)]),
      account("b", [hold("h2", "b", "ABC", 400_000)]),
    ])!;
    expect(f.biggestStock).toMatchObject({ ticker: "ABC", valueCents: 800_000 });
  });
});
