import { classWords } from "@/insights/portfolio-review";
import type { MixShare, RebalancePlan } from "@/insights/rebalance";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Jane's words about rebalancing (spec step 133). Pure. Every line about orders says
// they're simulated until a real brokerage is connected.

export const SIMULATED_WORDS = "in the simulated brokerage (no real money moves)";

export const rebalanceButton = (): MessageAction => ({
  id: "invest.rebalance",
  label: "Move to the recommended mix",
  kind: "primary",
});

export const mixLine = (rows: MixShare[]) =>
  rows
    .filter((r) => r.share > 0.0049 || r.target > 0)
    .map((r) => `${Math.round(r.share * 100)}% ${classWords(r.label)}`)
    .join(", ");

export function ordersLine(plan: RebalancePlan): string {
  const sells = plan.orders.filter((o) => o.side === "sell");
  const buys = plan.orders.filter((o) => o.side === "buy");
  const total = (side: typeof sells) => formatCents(side.reduce((s, o) => s + o.amountCents, 0));
  return `${plan.orders.length} orders: sell ${total(sells)} (${sells.map((o) => o.name).join(", ")}) and buy ${total(buys)} (${[...new Set(buys.map((o) => o.name))].join(", ")}).`;
}

export function planSummary(plan: RebalancePlan): string {
  return `${ordersLine(plan)} Before: ${mixLine(plan.before)}. After: ${mixLine(plan.after)}.`;
}
