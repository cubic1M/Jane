import { describe, expect, it } from "vitest";
import { FIT_COMFORT_SHARE, FIT_DTI_CEILING, FIT_NET_TO_GROSS } from "@/config/fit";
import type { LoanOffer } from "@/lib/lenders/partner";
import {
  amountFor,
  bandOf,
  cardFigure,
  improvements,
  nextBand,
  paymentLimit,
  priced,
  targetAmount,
} from "./borrowing-power";
import { fit, type FitPerson } from "./fit";
import { levelPaymentCents } from "./refinance";

// Spec step 250: what you could borrow, from the fit engine's limits and the lender's quotes.

const person = (over: Partial<FitPerson> = {}): FitPerson => ({
  creditScore: 700,
  incomeCents: 600_000,
  debtPaymentsCents: 50_000,
  cashCents: 2_000_000,
  debtTrouble: false,
  ...over,
});

const offer = (lender: string, aprBps: number, termMonths: number, feeCents = 0): LoanOffer => ({
  id: `${lender}-${aprBps}-${termMonths}`,
  lender,
  product: "auto",
  aprBps,
  rateType: "fixed",
  termMonths,
  feeCents,
  feeLabel: "",
  sourceUrl: "https://example.com",
  demo: true,
});

describe("the payment that fits", () => {
  it("is the comfortable share of take-home when debts leave room", () => {
    expect(paymentLimit(person(), "auto")).toEqual({
      paymentCents: Math.floor(600_000 * FIT_COMFORT_SHARE.auto),
      binding: "comfort",
    });
  });

  it("is what the lender's debt-to-income limit leaves when debts are high", () => {
    const heavy = person({ debtPaymentsCents: 350_000 });
    const room = Math.floor(FIT_DTI_CEILING.auto * (600_000 / FIT_NET_TO_GROSS) - 350_000);
    expect(paymentLimit(heavy, "auto")).toEqual({ paymentCents: room, binding: "dti" });
  });

  it("leaves out the payment a new mortgage replaces, and needs an income", () => {
    const owner = person({ debtPaymentsCents: 300_000 });
    expect(paymentLimit(owner, "mortgage", 250_000)!.paymentCents).toBeGreaterThan(
      paymentLimit(owner, "mortgage")!.paymentCents,
    );
    expect(paymentLimit(person({ incomeCents: null }), "auto")).toBeNull();
  });
});

describe("the amount", () => {
  it("is what the payment borrows at the lowest quote, rounded down", () => {
    expect(amountFor(levelPaymentCents(2_000_000, 600, 60), 600, 60)).toBeGreaterThan(1_999_000);
    const t = targetAmount(person(), "auto", [offer("A", 700, 60), offer("B", 600, 60)])!;
    expect(t.amountCents % 10_000).toBe(0);
    expect(levelPaymentCents(t.amountCents, 600, 60)).toBeLessThanOrEqual(t.limit.paymentCents);
  });

  it("is priced through the fit engine, so the pick is the loan options card's", () => {
    const p = person();
    const offers = [offer("A", 700, 60), offer("B", 600, 60, 50_000), offer("C", 650, 60)];
    const t = targetAmount(p, "auto", offers)!;
    const f = priced(p, "auto", t.amountCents, offers, t.limit);
    expect(f.available).toBe(true);
    // The amount is sized to the lowest rate's payment, so only that loan's payment fits; the
    // fit engine picks it even with its fee, as the options card would for the same amount.
    expect(f.lender).toBe("B");
    const card = fit({
      need: "car",
      product: "auto",
      amountCents: t.amountCents,
      person: p,
      offers,
    });
    expect(card.options.find((o) => o.id === card.pick)?.lender).toBe(f.lender);
    expect(f.paymentCents).toBeLessThanOrEqual(t.limit.paymentCents);
  });

  it("is nothing under the lender's score floor, with what would open it up", () => {
    const f = priced(person({ creditScore: 540 }), "auto", 1_000_000, [offer("A", 900, 60)], {
      paymentCents: 50_000,
      binding: "comfort",
    });
    expect(f.available).toBe(false);
    expect(f.why).toMatch(/score of 560/);
    expect(f.improve[0]).toMatch(/score of 560 would open this up/);
  });
});

describe("what would help", () => {
  const p = person({ debtPaymentsCents: 350_000 });
  const offers = [offer("A", 700, 60)];
  const t = targetAmount(p, "auto", offers)!;
  const f = priced(p, "auto", t.amountCents, offers, t.limit);

  it("names the next band's rate and what the same payment would borrow", () => {
    const lines = improvements(f, p, [offer("A", 650, 60)]);
    expect(lines[0]).toMatch(
      /^A score of 740 or more would likely bring the rate to about 6\.50% \(from 7\.00%\), so the same payment would borrow about \$[\d,.]+ more\.$/,
    );
  });

  it("prices each $100 a month less in debt payments when they set the limit", () => {
    expect(improvements(f, p, null).join(" ")).toMatch(
      /each \$100\.00 a month less in them adds about \$5,0\d\d/,
    );
  });

  it("knows the bands", () => {
    expect(bandOf(null)).toBe("good");
    expect(bandOf(760)).toBe("excellent");
    expect(nextBand("fair")).toEqual({ band: "good", score: 670 });
    expect(nextBand("excellent")).toBeNull();
  });
});

describe("a card", () => {
  it("takes the lowest go-to rate and guesses a limit from gross income by band", () => {
    const c = cardFigure(person(), [2_499, 2_199], [1_999]);
    expect(c).toMatchObject({ available: true, aprBps: 2_199 });
    // 12% of $92,308 a year, to the dollar.
    expect(c.limitCents).toBe(
      Math.round((((600_000 * 12) / FIT_NET_TO_GROSS) * 0.12) / 10_000) * 100,
    );
    expect(c.improve[0]).toMatch(/score of 740 or more would likely mean about 19\.99%/);
  });

  it("isn't shown without an income or a quote", () => {
    expect(cardFigure(person({ incomeCents: null }), [2_000], null).available).toBe(false);
    expect(cardFigure(person(), [], null).available).toBe(false);
  });
});
