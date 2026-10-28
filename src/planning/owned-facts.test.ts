import { describe, expect, it } from "vitest";
import type { HoldingView, InvestmentAccountView } from "@/insights/investments";
import { recommendsAChoice } from "@/lib/guardrails";
import { FUND_FACTS } from "@/config/funds";
import { ownedFacts } from "./owned-facts";

const hold = (
  ticker: string,
  valueCents: number,
  type: string,
  extra: Partial<HoldingView> = {},
): HoldingView => {
  const facts = FUND_FACTS[ticker];
  return {
    id: ticker,
    accountId: "a",
    name: extra.name ?? ticker,
    ticker,
    type,
    isCash: false,
    quantity: 1,
    priceCents: valueCents,
    valueCents,
    costBasisCents: null,
    gainCents: null,
    expenseRatioBps: facts?.expenseRatioBps ?? null,
    category: null,
    mix: facts?.mix ?? (type === "equity" ? { us_stocks: 1 } : { other: 1 }),
    source: "x",
    factsSource: null,
    ...extra,
  };
};
const account = (holdings: HoldingView[]): InvestmentAccountView =>
  ({ id: "a", name: "Fidelity", holdings }) as unknown as InvestmentAccountView;

describe("what a person owns, as facts", () => {
  const accounts = [
    account([
      hold("VTI", 5_000_000, "etf"),
      hold("TSLA", 1_500_000, "equity", { name: "Tesla" }),
      hold("ARKK", 500_000, "etf"),
      hold("XYZFX", 400_000, "mutual fund"),
      hold("SPAXX", 600_000, "cash", {
        isCash: true,
        ticker: null,
        name: "Money market",
        mix: { cash: 1 },
      }),
    ]),
  ];

  it("gives the mix, the biggest stock, the yearly fees in dollars and the cash", () => {
    const f = ownedFacts(accounts)!;
    expect(f.totalCents).toBe(8_000_000);
    expect(f.mix[0]).toMatchObject({ assetClass: "us_stocks" });
    expect(f.biggestStock).toMatchObject({ ticker: "TSLA", name: "Tesla" });
    expect(f.biggestStock!.share).toBeCloseTo(1_500_000 / 8_000_000, 6);
    // VTI 0.03% of $50,000 = $15; ARKK 0.75% of $5,000 = $37.50; TSLA is a stock, no fund fee.
    expect(f.fees.yearlyCents).toBe(1_500 + 3_750);
    expect(f.fees.top).toEqual({ name: "ARKK", yearlyCents: 3_750 });
    expect(f.fees.unknownNames).toEqual(["XYZFX"]);
    expect(f.cash).toMatchObject({ cents: 600_000 });
    expect(f.sentences.join(" ")).toMatch(/\$80,000\.00: .*% us stocks/);
    expect(f.sentences.join(" ")).toMatch(
      /largest single stock is Tesla \(TSLA\), \$15,000\.00, which is 19% of everything you own/,
    );
    expect(f.sentences.join(" ")).toMatch(
      /cost about \$52\.50 a year in fees, mostly ARKK at \$37\.50/,
    );
    expect(f.sentences.join(" ")).toMatch(/don't know the yearly cost of XYZFX/);
    expect(f.sentences.join(" ")).toMatch(/\$6,000\.00 \(8%\) is uninvested cash/);
  });

  it("never says to buy, sell, switch or hold anything", () => {
    const text = ownedFacts(accounts)!.sentences.join(" ");
    expect(text).not.toMatch(
      /\b(?:should|consider|recommend|switch|move|sell|buy|trim|reduce|too much|too high)\b/i,
    );
    expect(recommendsAChoice(text)).toBe(false);
    expect(text).not.toMatch(/\bwill\b/i);
  });

  it("says nothing without holdings", () => {
    expect(ownedFacts([account([])])).toBeNull();
  });

  it("leaves a fund-less portfolio of stocks out of the fee line", () => {
    const f = ownedFacts([account([hold("AAPL", 1_000_000, "equity", { name: "Apple" })])])!;
    expect(f.sentences.join(" ")).not.toMatch(/fees/);
  });
});
