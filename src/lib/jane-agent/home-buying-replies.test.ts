import { describe, expect, it } from "vitest";
import { HOME_DEFAULT_APR_BPS } from "@/config/home-buying";
import type { HomeBuying } from "@/lib/home-buying";
import { affordability, homeCosts, savingPlan } from "@/planning/home-buying";
import { homeReply } from "./home-buying-replies";

// "Can I afford a house?" for everyone: the 28/36 math from income and debts, a typical rate
// when there is no lender offer, in three sentences.

const home = (over: Partial<HomeBuying> = {}): HomeBuying => {
  const afford = affordability({
    monthlyNetIncomeCents: 600_000,
    debtPaymentsCents: 50_000,
    downShare: 0.1,
    aprBps: HOME_DEFAULT_APR_BPS,
    termMonths: 360,
  });
  const costs = homeCosts({
    priceCents: afford.maxPriceCents,
    downShare: 0.1,
    aprBps: HOME_DEFAULT_APR_BPS,
    termMonths: 360,
  });
  return {
    available: true,
    missing: null,
    affordability: afford,
    costs,
    downShare: 0.1,
    aprBps: HOME_DEFAULT_APR_BPS,
    rateIsOffer: false,
    advice: false,
    offers: [],
    saving: savingPlan({
      cashNeededCents: costs.cashNeededCents,
      savedCents: 1_000_000,
      monthlySavingCents: 80_000,
      asOf: "2026-10-18",
      targetDate: "2028-10-18",
    }),
    targetDate: "2028-10-18",
    savedCents: 1_000_000,
    monthlySavingCents: 80_000,
    hasGoal: false,
    assumptions: [],
    ...over,
  };
};
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/);

describe("can I afford a house", () => {
  it("for a real account is the 28/36 math in three sentences, with a typical rate and no advice", () => {
    const r = homeReply(home(), false);
    const s = sentences(r.body);
    expect(s).toHaveLength(3);
    expect(s[0]).toMatch(
      /^The usual 28\/36 rules allow a home up to about \$[\d,.]+ for you: \$[\d,.]+ a month with taxes and insurance/,
    );
    expect(s[1]).toMatch(
      /^That assumes 10% down \(\$[\d,.]+\) on a 30-year loan at 6\.50%, a typical rate rather than an offer, so about \$[\d,.]+ up front with closing costs\.$/,
    );
    expect(s[2]).toMatch(/^You have \$10,000\.00 saved/);
    expect(r.refs.advice).toBeUndefined();
    expect(r.body).not.toMatch(/\bI'd\b|You can afford/);
  });

  it("in demo advice says 'you can afford', names a lender's rate as an offer, and offers the goal", () => {
    const r = homeReply(home({ advice: true, rateIsOffer: true, aprBps: 589 }), false);
    expect(r.body).toMatch(/^You can afford a home up to about \$[\d,.]+/);
    expect(r.body).toContain("at 5.89%, so about");
    expect(r.body).not.toContain("typical rate");
    expect(r.refs.advice).toBe(true);
    expect(r.actions.map((a) => a.id)).toEqual(["home.goal", "open"]);
  });

  it("checks a price someone names against the rules", () => {
    const r = homeReply(home(), true);
    expect(r.body).toMatch(
      /^A \$[\d,.]+ home would cost about \$[\d,.]+ a month with taxes and insurance, (within|over) the /,
    );
  });

  it("says when the cash is already saved, or when the monthly saving gets there", () => {
    const saved = home({ saving: { ...home().saving!, stillNeededCents: 0 } });
    expect(sentences(homeReply(saved, false).body)[2]).toBe("You have that saved already.");
    expect(homeReply(saved, false).actions.map((a) => a.id)).toEqual(["open"]);
    const behind = home({
      saving: { ...home().saving!, onTrack: false, monthlyNeededCents: 123_400 },
    });
    expect(sentences(homeReply(behind, false).body)[2]).toMatch(
      /putting away \$1,234\.00 a month gets you there by /,
    );
  });

  it("needs income to see first", () => {
    expect(
      homeReply(home({ missing: "income", costs: null, affordability: null, saving: null }), false)
        .body,
    ).toMatch(/^I need a few months of income/);
  });
});
