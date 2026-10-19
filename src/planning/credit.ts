import { CREDIT_BANDS, UTILISATION_GOOD, UTILISATION_HIGH } from "@/config/debt";
import type { CreditFactor, CreditReport, CreditRequest } from "@/lib/credit/partner";
import { formatCents } from "@/lib/money";

// What's helping and hurting a credit score (spec step 116), from the partner's report
// and what Jane sees, and the card utilisation: the share of card limits in use and what
// to pay to bring it under the thresholds. Pure.

export const percent = (share: number) => `${Math.round(share * 100)}%`;

export type Utilisation = {
  share: number;
  balanceCents: number;
  limitCents: number;
  // What to pay off to report under 30% and under 10%; 0 when already under.
  toUnderHighCents: number;
  toUnderGoodCents: number;
};

export function utilisation(balanceCents: number, limitCents: number): Utilisation | null {
  if (limitCents <= 0) return null;
  const over = (share: number) => Math.max(0, Math.ceil(balanceCents - share * limitCents));
  return {
    share: balanceCents / limitCents,
    balanceCents,
    limitCents,
    toUnderHighCents: over(UTILISATION_HIGH),
    toUnderGoodCents: over(UTILISATION_GOOD),
  };
}

export function creditFactors(report: CreditReport, request: CreditRequest): CreditFactor[] {
  const u = utilisation(request.cardBalanceCents, report.cardLimitCents);
  const years = Math.floor(report.averageAgeMonths / 12);
  return [
    request.overdue
      ? {
          key: "payment_history",
          label: "Payment history",
          impact: "hurting",
          detail: "A loan shows as overdue.",
        }
      : request.lateFeesLastYear > 0
        ? {
            key: "payment_history",
            label: "Payment history",
            impact: "hurting",
            detail: `${request.lateFeesLastYear} late ${request.lateFeesLastYear === 1 ? "fee" : "fees"} in the last year.`,
          }
        : {
            key: "payment_history",
            label: "Payment history",
            impact: "helping",
            detail: "Every payment on time.",
          },
    u === null
      ? {
          key: "utilisation",
          label: "Card use",
          impact: "neutral",
          detail: "No card limits reported.",
        }
      : {
          key: "utilisation",
          label: "Card use",
          impact:
            u.share < UTILISATION_GOOD
              ? "helping"
              : u.share <= UTILISATION_HIGH
                ? "neutral"
                : "hurting",
          detail: `${percent(u.share)} of your card limits in use (${formatCents(u.balanceCents)} of ${formatCents(u.limitCents)}).`,
        },
    {
      key: "credit_age",
      label: "Age of accounts",
      impact: years >= 7 ? "helping" : years >= 3 ? "neutral" : "hurting",
      detail: `Your accounts average ${years} ${years === 1 ? "year" : "years"} old.`,
    },
    {
      key: "inquiries",
      label: "New credit",
      impact: report.hardInquiries <= 1 ? "neutral" : "hurting",
      detail: `${report.hardInquiries} hard ${report.hardInquiries === 1 ? "inquiry" : "inquiries"} in the last year.`,
    },
    {
      key: "mix",
      label: "Kinds of credit",
      impact: request.hasInstallmentLoan ? "helping" : "neutral",
      detail: request.hasInstallmentLoan ? "Cards and loans both paid as agreed." : "Cards only.",
    },
  ];
}

export function creditBandOf(score: number): "excellent" | "good" | "fair" {
  return score >= CREDIT_BANDS.excellent
    ? "excellent"
    : score >= CREDIT_BANDS.good
      ? "good"
      : "fair";
}
