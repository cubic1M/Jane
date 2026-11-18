import { describe, expect, it } from "vitest";
import { feeSummary } from "@/insights/investment-fees";
import type { HoldingView, InvestmentAccountView } from "@/insights/investments";
import { feesReply } from "./replies";

// Plaid sandbox walk with Investments on (11-17, First Platypus Bank's brokerage user): "How much
// am I paying in fees?" → "about $111.00 a year: $0.00 in fund costs, $111.00 in account fees",
// beside four funds Plaid gives no expense ratio for. A fund of unknown cost isn't free, and a
// coin, an option or a bond has no yearly fund cost to not know.

const holding = (name: string, type: string, valueCents: number): HoldingView =>
  ({
    securityId: name,
    name,
    ticker: null,
    type,
    valueCents,
    expenseRatioBps: null,
    isCash: false,
    mix: { other: 1 },
  }) as unknown as HoldingView;

const account = (holdings: HoldingView[]): InvestmentAccountView =>
  ({
    id: "acc_401k",
    name: "Plaid 401k",
    subtype: "401k",
    balanceCents: holdings.reduce((sum, h) => sum + h.valueCents, 0),
    holdings,
  }) as unknown as InvestmentAccountView;

const SANDBOX = account([
  holding("Cambiar International Equity Institutional", "mutual fund", 185_588),
  holding("Matthews Pacific Tiger Fund Insti Class", "mutual fund", 50_000),
  holding("Bitcoin", "cryptocurrency", 11_557),
  holding("NFLX Feb 01'18 $355 Call", "derivative", 1_000),
  holding("United States Treasury Bill", "fixed income", 100_000),
  holding("Southside Bancshares Inc.", "equity", 739_749),
]);
const FEE = { accountId: "acc_401k", subtype: "account fee", amountCents: 11_100 };

describe("investment fees Plaid doesn't give", () => {
  it("lists only funds as of unknown cost, never a coin, an option or a bond", () => {
    expect(feeSummary([SANDBOX], []).unknown).toEqual([
      "Cambiar International Equity Institutional",
      "Matthews Pacific Tiger Fund Insti Class",
    ]);
  });

  it("calls the total a floor and names the funds, never $0.00 in fund costs", () => {
    const body = feesReply(feeSummary([SANDBOX], [FEE]), false).body;
    expect(body).not.toContain("$0.00 in fund costs");
    expect(body).toMatch(/^Your investments cost at least \$111\.00 a year in account fees\./);
    expect(body).toContain(
      "I don't know the yearly cost of Cambiar International Equity Institutional, Matthews Pacific Tiger Fund Insti Class, so they aren't counted.",
    );
  });

  it("says it doesn't know, rather than that there are no fees, when nothing else is known", () => {
    const body = feesReply(feeSummary([SANDBOX], []), false).body;
    expect(body).not.toContain("I don't see any investment fees yet");
    expect(body).toContain(
      "I don't know the yearly cost of Cambiar International Equity Institutional",
    );
  });
});
