import { describe, expect, it } from "vitest";
import { DRIFT_POINTS, SINGLE_STOCK_LIMIT, TARGET_MIXES, type RiskLevel } from "@/config/investing";
import { checkGuardrails } from "@/lib/guardrails";
import { demoInvestments } from "@/lib/investments/__fixtures__/demo";
import type { HoldingView, InvestmentAccountView } from "./investments";
import { isEmployer, mixWords, reviewPortfolio } from "./portfolio-review";

// Spec step 131: does it fit? Recommendations follow the profile; nothing is promised.

const accounts = demoInvestments().accounts;
const LEVELS: RiskLevel[] = [1, 2, 3, 4, 5];

const holding = (over: Partial<HoldingView>): HoldingView => ({
  id: "h",
  accountId: "a",
  name: "Fund",
  ticker: null,
  type: "mutual fund",
  isCash: false,
  quantity: 1,
  priceCents: 100,
  valueCents: 0,
  costBasisCents: null,
  gainCents: null,
  expenseRatioBps: null,
  category: null,
  mix: { us_stocks: 1 },
  source: "Bank",
  factsSource: null,
  ...over,
});
const account = (holdings: HoldingView[]): InvestmentAccountView => ({
  id: "a",
  name: "Brokerage",
  kind: "investment",
  label: "Brokerage",
  subtype: "brokerage",
  balanceCents: holdings.reduce((s, h) => s + h.valueCents, 0),
  holdingsCents: holdings.reduce((s, h) => s + h.valueCents, 0),
  holdingsMatch: true,
  holdings,
  institution: null,
});

describe("the targets", () => {
  it("add up to everything at every level, with more stocks as the level rises", () => {
    let stocks = 0;
    for (const level of LEVELS) {
      const t = TARGET_MIXES[level];
      expect(t.us_stocks + t.intl_stocks + t.bonds + t.cash).toBeCloseTo(1, 10);
      expect(t.us_stocks + t.intl_stocks).toBeGreaterThan(stocks);
      stocks = t.us_stocks + t.intl_stocks;
    }
  });
});

describe("reviewPortfolio on the demo bank", () => {
  it("compares the mix with the profile's target, and the moves reach it", () => {
    const review = reviewPortfolio(accounts, 3);
    expect(review.mix.reduce((s, m) => s + m.share, 0)).toBeCloseTo(1, 6);
    for (const m of review.mix) {
      expect(m.targetShare).toBe(TARGET_MIXES[3][m.assetClass as "bonds"] ?? 0);
      expect(m.valueCents + m.changeCents).toBe(Math.round(review.totalCents * m.targetShare));
      expect(m.offTarget).toBe(Math.abs(m.share - m.targetShare) * 100 >= DRIFT_POINTS);
    }
    expect(review.totalCents).toBe(9_673_055);
  });

  it("recommends different changes for different profiles", () => {
    const moderate = reviewPortfolio(accounts, 3).recommendations[0];
    expect(moderate).toMatchObject({ kind: "rebalance" });
    expect(moderate.what).toMatch(
      /^Move about \$[\d,]+ from US stocks and cash into international stocks and bonds, using low-cost index funds: Keystone Total International Index Fund for international stocks and Keystone Total Bond Index Fund for bonds\.$/,
    );
    expect(moderate.why).toBe(
      "Your moderate profile aims for 40% US stocks, 20% international stocks, 35% bonds and 5% cash. You have 69% in US stocks against a target of 40%.",
    );
    const careful = reviewPortfolio(accounts, 1).recommendations[0];
    expect(careful.what).toMatch(/into cash and bonds/);
    const bold = reviewPortfolio(accounts, 5).recommendations[0];
    expect(bold.what).toMatch(/into international stocks/);
    expect(new Set([moderate.what, careful.what, bold.what]).size).toBe(3);
  });

  it("never promises anything about returns", () => {
    for (const level of LEVELS) {
      for (const r of reviewPortfolio(accounts, level).recommendations) {
        const text = `${r.what} ${r.why}`;
        const check = checkGuardrails(text, [r.amountCents], undefined, "demo_advice");
        expect(check, text).toEqual({ ok: true });
      }
    }
  });
});

describe("concentration and cash", () => {
  it("flags one company above the limit, and says when it's the person's employer", () => {
    const acme = holding({ id: "acme", name: "Acme Corp", type: "equity", valueCents: 3_000_000 });
    const index = holding({ id: "idx", valueCents: 7_000_000 });
    const review = reviewPortfolio([account([acme, index])], 4, ["ACME CORP PAYROLL"]);
    expect(review.concentrated).toEqual([
      expect.objectContaining({
        employer: true,
        share: 0.3,
        overCents: 3_000_000 - 10_000_000 * SINGLE_STOCK_LIMIT,
      }),
    ]);
    const rec = review.recommendations.find((r) => r.kind === "concentration")!;
    expect(rec.what).toBe(
      "Sell about $25,000 of Acme Corp to bring it to 5% of your investments, and put it into a broad fund.",
    );
    expect(rec.why).toMatch(/it's where you work/);
    expect(reviewPortfolio([account([acme, index])], 4, []).concentrated[0].employer).toBe(false);
  });

  it("leaves small positions and broad funds alone", () => {
    const small = holding({ name: "Tiny Co", type: "equity", valueCents: 60_000 });
    const index = holding({ id: "idx", valueCents: 940_000 });
    // 6% but only $100 over the limit: not worth a trade.
    expect(reviewPortfolio([account([small, index])], 3).concentrated).toEqual([]);
    expect(isEmployer(holding({ name: "Co" }), ["CO PAYROLL"])).toBe(false);
  });

  it("finds cash above the target mix", () => {
    const cash = holding({
      id: "c",
      name: "Cash",
      isCash: true,
      mix: { cash: 1 },
      valueCents: 3_000_000,
    });
    const stocks = holding({
      id: "s",
      mix: { us_stocks: 0.6, intl_stocks: 0.4 },
      valueCents: 7_000_000,
    });
    const review = reviewPortfolio([account([cash, stocks])], 5);
    expect(review.cashAboveTargetCents).toBe(3_000_000 - 200_000);
    expect(review.recommendations.find((r) => r.kind === "cash")?.what).toBe(
      "Invest about $28,000 of the cash in your investment accounts.",
    );
  });

  it("has nothing to change on target", () => {
    const t = TARGET_MIXES[3];
    const onTarget = holding({ mix: t, valueCents: 10_000_000 });
    expect(reviewPortfolio([account([onTarget])], 3)).toMatchObject({
      offTarget: false,
      recommendations: [],
    });
  });

  it("names a mix in words", () => {
    expect(mixWords({ us_stocks: 0.4, bonds: 0.6, cash: 0 })).toBe("40% US stocks and 60% bonds");
  });
});
