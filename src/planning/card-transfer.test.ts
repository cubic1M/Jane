import { describe, expect, it } from "vitest";
import {
  BT_DEFAULT_FEE_MIN_CENTS,
  BT_MIN_SAVING_CENTS,
  BT_PROMO_SLACK_MONTHS,
  HARD_PULL_TEXT,
} from "@/config/debt";
import { BT_CARD, REWARDS_CARD } from "@/lib/connectors/card-offers/__fixtures__/engine-offers";
import { parseCardOffer, type CardOffer } from "@/lib/connectors/card-offers/offer";
import { scoreCardTransfer, transferFeeCents } from "./card-transfer";

const AS_OF = "2026-11-06";
// Example Bank: 0% intro on transfers for 18 months, then up to 28.24% variable, 3% or $5.
const offer = parseCardOffer(BT_CARD);
const card = { balanceCents: 500_000, aprBps: 2_499, payCents: 30_000, offer, asOf: AS_OF };

const shown = (inputs: Parameters<typeof scoreCardTransfer>[0]) => {
  const result = scoreCardTransfer(inputs);
  if (!result.show) throw new Error(`expected a transfer, got ${result.reason}`);
  return result;
};

describe("the transfer fee", () => {
  it("is the percent, never under the minimum", () => {
    expect(transferFeeCents(500_000, offer)).toBe(15_000);
    expect(transferFeeCents(10_000, offer)).toBe(500);
  });

  it("falls back to the higher usual minimum when the offer gives none, and is unknown without a percent", () => {
    const noMinimum: CardOffer = { ...offer, transferFeeMinCents: null };
    expect(transferFeeCents(10_000, noMinimum)).toBe(BT_DEFAULT_FEE_MIN_CENTS);
    expect(transferFeeCents(500_000, { ...offer, transferFeeBps: null })).toBeNull();
  });
});

describe("scoreCardTransfer", () => {
  it("scores it at the person's own payment, fee and go-to rate counted", () => {
    const result = shown(card);
    expect(result.feeCents).toBe(15_000);
    // The top of the purchase range: the worse case.
    expect(result.goToAprBps).toBe(2_824);
    expect(result.promoMonths).toBe(18);
    expect(result.promoEndsOn).toBe("2028-05-06");
    // $5,150 at $300 a month, interest-free: 18 months, the last a little short.
    expect(result.monthsToClear).toBe(18);
    expect(result.moveCostCents).toBe(15_000);
    expect(result.savingCents).toBe(result.stayInterestCents - 15_000);
    expect(result.savingCents).toBeGreaterThanOrEqual(BT_MIN_SAVING_CENTS);
  });

  it("charges the go-to rate on what's left after the intro, within the slack", () => {
    // $280 a month: 19 months, the last at 28.24% on what's left.
    const result = shown({ ...card, payCents: 28_000 });
    expect(result.monthsToClear).toBe(19);
    expect(result.monthsToClear).toBeLessThanOrEqual(18 + BT_PROMO_SLACK_MONTHS);
    expect(result.moveCostCents).toBeGreaterThan(15_000);
  });

  it("says what payment clears it in time when the person's is too slow", () => {
    expect(scoreCardTransfer({ ...card, payCents: 20_000 })).toEqual({
      show: false,
      reason: "too_slow",
      paymentCents: Math.ceil(515_000 / 18),
    });
  });

  it("counts the annual fee for each year it takes", () => {
    const withFee = shown({ ...card, offer: { ...offer, annualFeeCents: 9_500 } });
    // 18 months is two card years.
    expect(withFee.moveCostCents).toBe(15_000 + 2 * 9_500);
    expect(withFee.lines[0]).toContain("$95.00 annual fee");
  });

  it("keeps quiet when it saves too little", () => {
    expect(scoreCardTransfer({ ...card, balanceCents: 60_000, aprBps: 1_299 })).toMatchObject({
      show: false,
      reason: "saves_too_little",
    });
  });

  it("keeps quiet without the terms Reg Z wants shown, or a payment that never clears", () => {
    // The rewards card has no intro transfer rate or fee.
    expect(scoreCardTransfer({ ...card, offer: parseCardOffer(REWARDS_CARD) })).toMatchObject({
      show: false,
      reason: "no_terms",
    });
    expect(
      scoreCardTransfer({
        ...card,
        offer: { ...offer, purchaseAprMinBps: null, purchaseAprMaxBps: null },
      }),
    ).toMatchObject({ reason: "no_terms" });
    expect(scoreCardTransfer({ ...card, payCents: 0 })).toMatchObject({ reason: "no_terms" });
    // $100 a month doesn't cover 24.99% on $5,000.
    expect(scoreCardTransfer({ ...card, payCents: 10_000 })).toMatchObject({
      reason: "never_clears",
    });
  });

  it("puts intro, its end, the go-to APR and the fee in one line, and the hard-pull text", () => {
    const [terms, saving, pull] = shown(card).lines;
    expect(terms).toBe(
      "Example Transfer Card: 0.00% intro APR on transfers for 18 months, to May 6, 2028; then 28.24% variable APR; a $150.00 transfer fee, no annual fee.",
    );
    expect(saving).toMatch(/^Paying \$300\.00 a month, it's gone in 18 months/);
    expect(pull).toBe(HARD_PULL_TEXT);
  });
});
