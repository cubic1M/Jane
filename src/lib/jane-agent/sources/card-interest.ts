import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { INTEREST_PAGE, askButton, firstAsk } from "../card-interest-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Less interest on every card (spec step 224). A promotion off pace (its deadline is on the
// deadlines list), a request for a lower rate ready to send on a tap, and the lender's
// answer.

export const cardInterestSource: MessageSource = {
  key: "card_interest",
  gather: (snapshot): Candidate[] => {
    const data = snapshot.cardInterest;
    if (!data?.available) return [];
    const out: Candidate[] = [];
    for (const p of data.promos) {
      if (p.plan.ended || p.plan.onPace) continue;
      out.push({
        kind: "heads_up",
        body: `${p.cardName}'s 0% ends in ${p.plan.daysLeft} days and you're ${formatCents(p.plan.shortCents)} a month short of clearing it: ${formatCents(p.plan.monthlyNeededCents)} a month would. ${p.deferred ? `Interest from the start at ${(p.goToAprBps / 100).toFixed(2)}% is charged on what's left, about ${formatCents(p.plan.costIfMissedCents)} at your current pace. ` : ""}It's on your deadlines.`,
        refs: { advice: true },
        actions: [INTEREST_PAGE, snoozeButton()],
        dedupeKey: `promo:${p.id}:${p.endsOn}`,
        priority: MESSAGE_PRIORITY.promo_off_pace,
      });
    }
    const next = firstAsk(data);
    if (next?.rate) {
      out.push({
        kind: "decision",
        body: `${next.name} charges ${(next.aprBps / 100).toFixed(2)}% on ${formatCents(next.balanceCents)}. Asking for ${(next.rate.newAprBps / 100).toFixed(2)}% would save about ${formatCents(next.rate.savingYearlyCents)} a year. I've written the request and a call script; nothing is sent until you tap.`,
        refs: { advice: true, cardRate: { id: next.rate.id } },
        actions: [askButton(next.name), INTEREST_PAGE, snoozeButton()],
        dedupeKey: `cardrate:${next.rate.id}`,
        priority: MESSAGE_PRIORITY.card_rate_ask,
      });
    }
    for (const r of data.requests) {
      if (r.status === "sent" || !r.resolvedOn) continue;
      out.push({
        kind: r.status === "granted" ? "done" : "heads_up",
        body: `${r.cardName} answered your request for a lower rate. ${r.outcome ?? ""}`.trim(),
        refs: {},
        actions: [INTEREST_PAGE],
        dedupeKey: `cardrate_answer:${r.id}`,
        priority: MESSAGE_PRIORITY.card_rate_answer,
      });
    }
    return out;
  },
};
