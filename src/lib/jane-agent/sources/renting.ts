import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { dayLabel } from "@/lib/day-label";
import { RENTING_PAGE, reportOnButton } from "../renting-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Renting, counted (spec step 248): a security deposit coming due back (or overdue) is brought
// up with its date; a rent increase well past the usual is said once a year; and rent that
// isn't reported yet is offered once a year with the button that is the opt-in.

export const rentingSource: MessageSource = {
  key: "renting",
  gather: (snapshot, context): Candidate[] => {
    const d = snapshot.renting;
    if (!d) return [];
    const out: Candidate[] = [];
    const year = context.local.date.slice(0, 4);
    for (const x of d.deposits.filter((x) => x.needsAttention)) {
      const v = x.view;
      out.push({
        kind: "heads_up",
        body:
          v.status === "overdue"
            ? `Your ${formatCents(x.amountCents)} security deposit was due back ${dayLabel(v.dueOn!)}. ${v.rule.note} If you haven't had it or a list of deductions, ask in writing; ${v.rule.source} has the rules.`
            : `Your ${formatCents(x.amountCents)} security deposit is due back by ${dayLabel(v.dueOn!)}. ${v.rule.note}`,
        refs: {},
        actions: [RENTING_PAGE, snoozeButton()],
        dedupeKey: `deposit:${x.id}:${v.status}`,
        priority: MESSAGE_PRIORITY.rent_deposit,
      });
    }
    if (d.rise?.askAbout) {
      out.push({
        kind: "heads_up",
        body: `Your rent went up from ${formatCents(d.rise.beforeCents)} to ${formatCents(d.rise.nowCents)}, ${formatCents(d.rise.yearlyExtraCents)} more a year, against a usual ${(d.rise.usualBps / 100).toFixed(0)}% rise. It's worth asking your landlord whether it can be less.`,
        refs: {},
        actions: [RENTING_PAGE, snoozeButton()],
        dedupeKey: `rent-rise:${d.rise.nowCents}`,
        priority: MESSAGE_PRIORITY.rent_rise,
      });
    }
    // Only where Jane acts for the person (debugger 11-01: a real account was offered reporting
    // through the stand-in partner, which reports nothing; read-only mode, src/lib/concierge-mode.ts).
    if (d.renter && !d.reporting.on && snapshot.concierge !== false) {
      out.push({
        kind: "heads_up",
        body: `You pay ${formatCents(d.monthlyCents!)} in rent on time and it isn't building your credit. I can have it reported to the credit bureaus; it costs about ${formatCents(d.reporting.monthlyFeeCents)} a month and only starts if you say yes.`,
        refs: {},
        actions: [reportOnButton(), RENTING_PAGE, snoozeButton()],
        dedupeKey: `rent-report:${year}`,
        priority: MESSAGE_PRIORITY.rent_report,
      });
    }
    return out;
  },
};
