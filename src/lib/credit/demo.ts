import type { CreditChange, CreditPartner, CreditReport, CreditRequest } from "./partner";

// The stand-in credit partner (spec step 116), for the demo bank only: a made-up score in
// the usual 300–850 range, worked out from what Jane can see (card balances against a
// stand-in card limit, an overdue loan, late fees) plus stand-in bureau facts. Always
// labelled; never a real score. Pure.

export const DEMO_CARD_LIMIT_CENTS = 800_000;
const DEMO_AVERAGE_AGE_MONTHS = 86;
const DEMO_HARD_INQUIRIES = 1;
const BASE = 760;

export function demoScore(request: CreditRequest, change: CreditChange = {}): number {
  const limit = DEMO_CARD_LIMIT_CENTS + (change.extraLimitCents ?? 0);
  const u = (change.cardBalanceCents ?? request.cardBalanceCents) / limit;
  const utilisation = u < 0.1 ? 0 : u < 0.3 ? 20 : u < 0.5 ? 45 : u < 0.75 ? 70 : 100;
  const late = Math.min(3, change.lateFeesLastYear ?? request.lateFeesLastYear) * 15;
  const overdue = request.overdue ? 60 : 0;
  const mix = (change.hasInstallmentLoan ?? request.hasInstallmentLoan) ? 10 : 0;
  const inquiries = DEMO_HARD_INQUIRIES + (change.extraInquiries ?? 0);
  const score = BASE - utilisation - late - overdue - inquiries * 5 + mix;
  return Math.max(300, Math.min(850, score));
}

export const demoCredit: CreditPartner = {
  name: "Stand-in credit score (demo)",
  async softPull(request): Promise<CreditReport> {
    return {
      score: demoScore(request),
      model: "Stand-in score, 300–850",
      range: { low: 300, high: 850 },
      cardLimitCents: DEMO_CARD_LIMIT_CENTS,
      averageAgeMonths: DEMO_AVERAGE_AGE_MONTHS,
      hardInquiries: DEMO_HARD_INQUIRIES,
      demo: true,
    };
  },
  async estimate(request, change) {
    return demoScore(request, change);
  },
};
