import { describe, expect, it } from "vitest";
import { BT_CARD, REWARDS_CARD } from "./__fixtures__/engine-offers";
import {
  OfferError,
  cardSuggestionExcluded,
  minimumFromDisclaimer,
  offerBlock,
  parseCardOffer,
  regZProblems,
  type CardSuggestionFacts,
} from "./offer";

// Card offers read tolerantly and shown the Reg Z way (connectors roadmap round 15). Mock only.

describe("parseCardOffer", () => {
  it("reads Engine's shapes, both spellings, and the fee's minimum from its disclaimer", () => {
    expect(parseCardOffer(BT_CARD)).toEqual({
      id: "offer-fake-bt",
      cardName: "Example Transfer Card",
      issuer: "Example Bank",
      ratesUrl: "https://cards.example-bank.test/rates",
      purchaseAprMinBps: 1924,
      purchaseAprMaxBps: 2824,
      variable: true,
      introPurchaseAprBps: 0,
      introPurchaseMonths: 15,
      introTransferAprBps: 0,
      introTransferMonths: 18,
      transferFeeBps: 300,
      transferFeeMinCents: 500,
      annualFeeCents: 0,
      preApproved: false,
      creditRatingDisclaimer: "Recommended for good to excellent credit.",
    });
    expect(parseCardOffer(REWARDS_CARD)).toMatchObject({
      purchaseAprMinBps: 2199,
      purchaseAprMaxBps: null,
      variable: true,
      annualFeeCents: 9_500,
      introTransferAprBps: null,
      creditRatingDisclaimer: "Excellent credit recommended.",
    });
    expect(minimumFromDisclaimer("3% of each transfer, minimum $10.00")).toBe(1_000);
    expect(minimumFromDisclaimer("3% of each transfer")).toBeNull();
  });

  it("refuses an offer without a name or an https Rates & Fees page", () => {
    expect(() => parseCardOffer({ details: { ratesUrl: "https://x.test" } })).toThrow(OfferError);
    expect(() => parseCardOffer({ details: { cardName: "X", ratesUrl: "http://x.test" } })).toThrow(
      OfferError,
    );
  });
});

describe("offerBlock and regZProblems", () => {
  it("builds blocks that pass every display rule", () => {
    for (const raw of [BT_CARD, REWARDS_CARD]) {
      const offer = parseCardOffer(raw);
      const block = offerBlock(offer);
      expect(regZProblems(block, offer), offer.cardName).toEqual([]);
    }
    const lines = offerBlock(parseCardOffer(BT_CARD)).lines;
    expect(lines).toContain(
      "0.00% intro APR on balance transfers for 18 months, then 19.24% to 28.24% variable APR; transfer fee 3.00% (at least $5)",
    );
    expect(lines).toContain("Annual fee: $0");
  });

  it("catches each way a block can break the rules", () => {
    const offer = parseCardOffer(BT_CARD);
    const good = offerBlock(offer);
    const broken = (lines: string[], link = good.ratesLink) =>
      regZProblems({ lines, ratesLink: link }, offer);
    expect(
      broken(["0% APR on purchases for 15 months, then 19.24% APR", "Annual fee: $0"]),
    ).toContain("an intro rate without 'intro'");
    expect(broken(["0% intro APR on purchases, then 19.24% APR", "Annual fee: $0"])).toContain(
      "an intro rate without its end",
    );
    expect(broken(["0% intro APR on purchases for 15 months", "Annual fee: $0"])).toContain(
      "an intro rate without the APR after",
    );
    expect(
      broken([
        "0% intro APR on balance transfers for 18 months, then 19.24% APR",
        "Annual fee: $0",
      ]),
    ).toContain("a transfer intro rate without its fee");
    expect(broken(["19.24% APR", "Regular APR: 19.24%"])).toContain(
      "a rate without the annual fee",
    );
    expect(broken(["Fixed 9.99% APR", "Annual fee: $0"])).toContain("'fixed' without a period");
    expect(broken(good.lines, { label: "Terms", url: "https://x.test" })).toContain(
      "no Rates & Fees link",
    );
    expect(broken([...good.lines, "You're pre-approved!"])).toContain("'pre-approved' unearned");
  });
});

describe("cardSuggestionExcluded", () => {
  const fine: CardSuggestionFacts = {
    overdue: false,
    lateFeeLast12Months: false,
    newCardLast6Months: false,
    ageBand: "21_plus",
    independentIncome: null,
    hardship: false,
  };

  it("lets a person with none of the exclusions through", () => {
    expect(cardSuggestionExcluded(fine)).toBeNull();
    expect(
      cardSuggestionExcluded({ ...fine, ageBand: "under_21", independentIncome: true }),
    ).toBeNull();
  });

  it("excludes each case, and asks the age band before anything", () => {
    expect(cardSuggestionExcluded({ ...fine, overdue: true })).toBe("overdue");
    expect(cardSuggestionExcluded({ ...fine, lateFeeLast12Months: true })).toBe("late_fee");
    expect(cardSuggestionExcluded({ ...fine, newCardLast6Months: true })).toBe("new_card");
    expect(cardSuggestionExcluded({ ...fine, hardship: true })).toBe("hardship");
    expect(cardSuggestionExcluded({ ...fine, ageBand: null })).toBe("age_unknown");
    expect(cardSuggestionExcluded({ ...fine, ageBand: "under_21" })).toBe("under_21_no_income");
  });
});
