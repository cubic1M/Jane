import { COMPANY_DROP, EMPLOYER_STOCK_LIMIT } from "@/config/company-stock";
import type { CompanyStockView } from "@/lib/investments/company-stock";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";
import { SIMULATED_WORDS } from "./rebalance-copy";
import { formatPercent as pct } from "@/lib/percent";
import { dayLabel } from "@/lib/day-label";

// Company stock in the chat (spec step 160): the words Jane's message, reply and tool share.

type View = Pick<CompanyStockView, "company" | "concentration" | "plan">;

export const COMPANY_LINK: MessageAction = {
  id: "open",
  label: "See your company stock",
  kind: "link",
  href: "/investments/company-stock",
};

// "Acme Corp is 28% of what you've invested (36% with what's still to vest)."
export function concentrationLine(view: View): string {
  const c = view.concentration;
  const unvested =
    c.unvestedCents > 0
      ? ` (${pct(c.shareWithUnvested)} with the ${formatCents(c.unvestedCents)} still to vest)`
      : "";
  return `${view.company ?? "Your company's stock"} is ${formatCents(c.heldCents)}, ${pct(c.share)} of what you've invested${unvested}.`;
}

// The plan in a sentence: how many parts, what the first sells, its tax and the risk removed.
export function planLine(view: View, today: string): string | null {
  const plan = view.plan;
  const first = plan?.parts[0];
  if (!plan || !first) return null;
  const when = plan.parts.length > 1 ? `, then ${plan.parts.length - 1} more every 3 months` : "";
  return `A common rule is to keep it under ${pct(EMPLOYER_STOCK_LIMIT)}, because a bad year for the company would hit your job and your savings at once. Selling about ${formatCents(plan.sellCents)} in ${plan.parts.length} ${plan.parts.length === 1 ? "part" : "parts"} brings it to ${pct(plan.shareAfter)}: the ${first.on > today ? `next part, on ${dayLabel(first.on, { year: true })}` : "first part, now"}, is ${formatCents(first.proceedsCents)} with about ${formatCents(first.taxCents)} in estimated tax on the gain${when}. A ${pct(COMPANY_DROP)} drop in the stock would then cost about ${formatCents(plan.dropAfterCents)} instead of ${formatCents(plan.dropBeforeCents)}.`;
}

export const sellDue = (view: View, today: string) =>
  Boolean(view.plan?.parts[0] && view.plan.parts[0].on <= today);

export const sellButton = (view: View): MessageAction => ({
  id: "company.sell",
  label: `Sell ${formatCents(view.plan?.parts[0]?.proceedsCents ?? 0)} now`,
  kind: "primary",
});

export const SELL_WORDS = `Tap and I'll sell this part and buy broad index funds with it, ${SIMULATED_WORDS}.`;
