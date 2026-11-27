import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";

import { payoffReply } from "../debt-replies";
import { type MessageSource } from "./source";
import { monthLabel } from "@/lib/day-label";
import { monthAfter, payoffSummary } from "@/planning/payoff";
import { openLink } from "../types";

// Payoff plans (spec step 110). Jane builds the plan on its own: once there are debts to
// pay off and no plan yet, it brings it up with the buttons that start it (demo advice
// mode: its pick and why, labelled). Once a plan is running it checks it every month
// (src/lib/debt-plan.ts refreshDebtPlan) and says how it went: behind, with what's owed
// against what the plan expected and the new debt-free month, or on track.

const planner = openLink("Open the payoff planner", "/debt");

export const payoffSource: MessageSource = {
  key: "payoff",
  gather: (snapshot) => {
    const payoff = snapshot.payoff;
    if (!payoff) return [];
    const { stored } = payoff;
    if (!stored) {
      if (payoff.summary.cards.length === 0) return [];
      const reply = payoffReply(payoff, snapshot.asOf);
      return [
        {
          kind: "decision" as const,
          body: `I worked out a plan to pay off your debts.\n${reply.body}`,
          refs: reply.refs,
          actions: reply.actions,
          dedupeKey: "offer",
          priority: MESSAGE_PRIORITY.payoff_offer,
        },
      ];
    }
    if (!stored.status || stored.expectedCents === null || stored.actualCents === null) return [];
    // The stored plan covers only the debts it includes: say so when others are left out.
    // Debts that came after the plan was made are not in what its check measured (a plan with no
    // record of its debts cannot say which: its figures are said of "the debts in your plan",
    // never of all).
    const excluded = new Set(stored.checkExcludedIds ?? []);
    const added = payoff.summary.cards.filter((c) => excluded.has(c.id)).map((c) => c.name);
    const outside = [...payoff.summary.leftOut.map((l) => l.name), ...added];
    // One message, one meaning: "left" and "done by" are said of the debts the plan covered (what
    // the check measured), at the plan's own payment. When it was then laid out again over the
    // debts added since, that is its own sentence with its own month.
    let covered = stored.debtFreeMonth;
    let again = "";
    if (added.length > 0) {
      const own = payoffSummary(
        payoff.book.debts.filter((d) => !excluded.has(d.key)),
        { extraCents: stored.extraCents, advice: false },
      )[stored.strategy];
      covered = own.ok ? monthAfter(snapshot.asOf, own.months) : null;
      const all = stored.debtFreeMonth
        ? `ends ${monthLabel(stored.debtFreeMonth, { long: true })}`
        : "doesn't finish at this pace";
      again = ` With ${added.join(", ")} added, the new plan ${all}.`;
    }
    const when = covered ? monthLabel(covered, { long: true }) : null;
    const scope = (outside.length > 0 ? ` Not in this plan: ${outside.join(", ")}.` : "") + again;
    const these = "the debts in your plan add up";
    const finish = "done with these";
    if (stored.status === "off_track") {
      const was =
        stored.previousDebtFreeMonth && stored.previousDebtFreeMonth !== covered
          ? ` instead of ${monthLabel(stored.previousDebtFreeMonth, { long: true })}`
          : "";
      return [
        {
          kind: "heads_up" as const,
          body: `Your payoff plan is off track: ${these} to ${formatCents(stored.actualCents)}, and the plan expected ${formatCents(stored.expectedCents)} by now, ${formatCents(stored.actualCents - stored.expectedCents)} behind. ${when ? `At this pace you'd be ${finish} by ${when}${was}.` : "At this pace it wouldn't finish."}${scope} New charges on a card or a missed payment usually explain it.`,
          refs: {},
          actions: [planner],
          dedupeKey: `check:${stored.checkedOn}`,
          priority: MESSAGE_PRIORITY.payoff_off_track,
        },
      ];
    }
    return [
      {
        kind: "done" as const,
        body: `I checked your payoff plan: you're on track, with ${formatCents(stored.actualCents)} left${when ? `, ${finish} by ${when}` : ""}.${scope} I've updated it from your new balances.`,
        refs: {},
        actions: [planner],
        dedupeKey: `check:${stored.checkedOn}`,
        priority: MESSAGE_PRIORITY.payoff_on_track,
      },
    ];
  },
};
