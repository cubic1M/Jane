import type { AdvisoryView, ProductView } from "@/lib/investments/costly-products";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Costly products in the chat (spec step 215): shared words. Rule: any sentence about
// leaving carries the surrender charge and when it ends. Nothing says "cancel".

export const COSTLY_LINK: MessageAction = {
  id: "open",
  label: "See what they cost",
  kind: "link",
  href: "/investments/costly-products",
};

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function productLine(p: ProductView): string {
  const cost =
    p.kind === "annuity"
      ? `Your ${p.name} costs about ${formatCents(p.yearlyCostCents ?? 0)} a year (${(p.feeBps ?? 0) / 100}% of ${formatCents(p.valueCents)}).`
      : `Your ${p.name} takes ${formatCents(p.premiumYearlyCents)} a year in premiums, and its cash value is ${formatCents(p.valueCents)}.`;
  const sur = p.surrender
    ? ` Leaving now would carry a ${p.surrender.pctNow}% surrender charge (${formatCents(p.surrender.cents)}), which reaches zero on ${day(p.surrender.endsOn)}.`
    : "";
  const gap = p.gap
    ? ` The same money in a low-cost fund could be worth ${formatCents(p.gap.lowCents)} to ${formatCents(p.gap.highCents)} more after ${p.gap.years} years (a cost difference, not a forecast).`
    : p.wholeLife
      ? ` The same premiums in a low-cost fund could be worth ${formatCents(p.wholeLife.inFundsCents.lowCents)} to ${formatCents(p.wholeLife.inFundsCents.highCents)}; you've paid in about ${formatCents(p.wholeLife.paidCents)}.`
      : "";
  const exit = p.exit
    ? p.exit.verdict === "wait"
      ? ` Waiting ${p.exit.bestWaitYears} years before leaving would cost the least, about ${formatCents(p.exit.bestCents)} against ${formatCents(p.exit.stayCents)} for staying, over ${p.exit.horizonYears} years.`
      : p.exit.verdict === "leave_now"
        ? ` Over ${p.exit.horizonYears} years leaving now, surrender charge included, costs about ${formatCents(p.exit.leaveNowCents)} against ${formatCents(p.exit.stayCents)} for staying.`
        : " Staying is fine on cost."
    : "";
  return `${cost}${sur}${gap}${exit}${p.note ? ` ${p.note}` : ""}`;
}

export const advisoryLine = (a: AdvisoryView) =>
  `You paid ${formatCents(a.yearlyCents)} in advisory fees in the last 12 months on about ${formatCents(a.assetsCents)} (${a.feeBps / 100}% a year), besides the funds' own costs; a low-cost fund alone would cost about ${formatCents(a.lowCostYearlyCents)}. Over ${a.gap.years} years that cost difference could be ${formatCents(a.gap.lowCents)} to ${formatCents(a.gap.highCents)}.`;

export const premiumQuestion = (a: { provider: string; yearlyCents: number }) =>
  `You paid ${a.provider} about ${formatCents(a.yearlyCents)} in the last year. Is that a whole life policy? I'll show what it really costs and what leaving would cost, before anything else.`;
