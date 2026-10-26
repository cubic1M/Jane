import type { PlanMenuView } from "@/lib/investments/plan-menu";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";
import { formatPercent as pct } from "@/lib/percent";

// The workplace plan's menu in the chat (spec step 232): shared words and buttons.

export const MENU_LINK: MessageAction = {
  id: "open",
  label: "See your plan's funds",
  kind: "link",
  href: "/investments/plan-menu",
};

const bps = (n: number) => `${(n / 100).toFixed(2)}%`;

export const proposedLine = (m: NonNullable<PlanMenuView["proposed"]>) =>
  `I read ${m.funds.length} funds from your plan's list: ${m.funds.map((f) => `${f.ticker} (${bps(f.expenseBps)})`).join(", ")}. Is that right? I'll only suggest funds from this list.`;

export function savingLine(plan: NonNullable<PlanMenuView["plan"]>): string {
  const mix = plan.suggested.map((a) => `${pct(a.share)} ${a.ticker}`).join(", ");
  const td = plan.targetDates.find(Boolean);
  const tdLine = td
    ? ` Its target-date fund ${td.ticker} costs ${bps(td.fundBps)}; building the same mix by hand costs ${bps(td.handBps)}, ${formatCents(td.savingCents)} a year less on your balance.`
    : "";
  return `Your ${plan.accountName} costs about ${formatCents(Math.round((plan.balanceCents * plan.currentBps) / 10_000))} a year in fund fees (${bps(plan.currentBps)}). The cheapest mix of your plan's own funds for your target is ${mix}, about ${bps(plan.suggestedBps)}: ${formatCents(plan.savingCents)} a year less.${tdLine}`;
}

export const confirmButtons = (): MessageAction[] => [
  { id: "menu.confirm", label: "Yes, that's right", kind: "primary" },
];
export const changeButton = (plan: NonNullable<PlanMenuView["plan"]>): MessageAction => ({
  id: "menu.change",
  label: `Send this mix (saves ${formatCents(plan.savingCents)} a year)`,
  kind: "primary",
});
