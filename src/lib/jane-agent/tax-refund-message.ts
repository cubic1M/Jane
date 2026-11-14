import type { RefundView } from "@/lib/tax-refund";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { listOf } from "@/planning/tax-profile";
import { type MessageAction, type MessageRefs, openLink } from "./types";
import { dayLabel } from "@/lib/day-label";

// A tax refund in the chat (spec step 125): spotted, matched to the estimate and, in demo
// advice mode, where it could go, set up with one tap.

function matchLine(view: RefundView): string {
  const m = view.match;
  if (!m) return "";
  if (m.matches)
    return ` That's what I estimated for ${view.refund.taxYear} (about ${formatWholeDollars(m.estimatedCents)}).`;
  return ` I'd estimated about ${formatWholeDollars(m.estimatedCents)} for ${view.refund.taxYear}, so it's ${formatWholeDollars(Math.abs(m.diffCents))} ${m.diffCents > 0 ? "more" : "less"}.`;
}

export function refundMessage(view: RefundView): {
  body: string;
  actions: MessageAction[];
  refs: MessageRefs;
} {
  const r = view.refund;
  const landed = `Your ${r.to} tax refund of ${formatCents(r.cents)} landed on ${dayLabel(r.date)}.${matchLine(view)}`;
  if (!view.plan || view.plan.items.length === 0) {
    return {
      body: landed,
      actions: [openLink("See your taxes", "/taxes?focus=estimate:refund")],
      refs: { taxRefund: r.transactionId },
    };
  }
  const parts = view.plan.items.map((i) => `${formatWholeDollars(i.cents)} to ${i.label}`);
  const rest =
    view.plan.leftCents > 0
      ? `, and ${formatWholeDollars(view.plan.leftCents)} left to use as you like`
      : "";
  return {
    body: `${landed} Where it could go: ${listOf(parts)}${rest}. Set it up? I'll add the goals and reminders; moving the money stays with you.`,
    actions: [
      { id: "tax.refund_apply", label: "Set it up", kind: "primary" },
      { id: "tax.refund_no", label: "Not this time", kind: "secondary" },
    ],
    refs: { advice: true, taxRefund: r.transactionId },
  };
}
