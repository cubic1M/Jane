import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { BNPL_PAGE, payoffButton } from "../bnpl-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Buy now, pay later under control (spec step 176). Installments the forecast didn't count
// that fall before payday, and a Pay in 4 plan that's free to pay off now (one tap).

export const bnplSource: MessageSource = {
  key: "bnpl",
  gather: (snapshot): Candidate[] => {
    const data = snapshot.bnpl;
    if (!data?.available || data.plans.length === 0) return [];
    const out: Candidate[] = [];
    const payday = snapshot.safeToSpend?.payday ?? null;
    const before = data.missing.filter((i) => payday === null || i.date <= payday);
    const cents = before.reduce((s, i) => s + i.cents, 0);
    if (before.length > 0) {
      out.push({
        kind: "heads_up",
        body: `${formatCents(cents)} in buy now, pay later installments come before payday and weren't in your forecast: ${before.map((i) => `${formatCents(i.cents)} to ${i.name} on ${dayLabel(i.date)}`).join(", ")}. I've taken them off your safe to spend.`,
        refs: {},
        actions: [BNPL_PAGE, snoozeButton()],
        dedupeKey: `bnpl_due:${before[0].date}:${before[0].planKey}`,
        priority: MESSAGE_PRIORITY.bnpl_due,
      });
    }
    const free = data.plans.find((p) => p.freePayoff && p.canCoverPayoff && !p.payoffScheduled);
    if (free) {
      out.push({
        kind: "decision",
        body: `You can pay off the ${free.name} now for ${formatCents(free.balanceCents!)}, and it costs nothing extra: Pay in 4 plans charge no interest or fee for paying early. That clears its remaining installments and leaves checking above its cushion.`,
        refs: { advice: true, bnplPlan: { key: free.key } },
        actions: [payoffButton(free.name), BNPL_PAGE, snoozeButton()],
        dedupeKey: `bnpl_payoff:${free.key}:${free.balanceCents}`,
        priority: MESSAGE_PRIORITY.bnpl_payoff,
      });
    }
    return out;
  },
};
