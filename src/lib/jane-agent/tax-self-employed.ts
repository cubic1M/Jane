import { IRS_DIRECT_PAY_URL, QUARTERLY } from "@/config/tax";
import { formatCents } from "@/lib/money";
import type { SelfEmployedView } from "@/lib/self-employed";
import { roundDollars } from "@/planning/tax-estimate-copy";
import { stateName } from "@/planning/tax-profile";
import type { MessageAction, MessageRefs } from "./types";
import { DAY_MS } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";

// Freelancers in the chat (spec step 123): the next estimated tax payment, before it's due,
// with the amount; what to set aside from each payment. Demo advice, labelled.

export type Said = { body: string; actions: MessageAction[]; refs: MessageRefs };

const link = (label: string, href: string): MessageAction => ({
  id: "open",
  label,
  kind: "link",
  href,
});

// The next payment within QUARTERLY.remindDays of today, if any.
export function nextQuarter(view: SelfEmployedView, today: string) {
  if (!view.active || !view.federal.needed) return null;
  const next = view.federal.payments.find((p) => p.date >= today);
  if (!next) return null;
  const days = (Date.parse(`${next.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS;
  if (days > QUARTERLY.remindDays) return null;
  const state = view.state?.payments.find((p) => p.date === next.date) ?? null;
  return { ...next, stateCents: state?.cents ?? 0 };
}

export function quarterMessage(
  view: SelfEmployedView,
  q: { date: string; cents: number; stateCents: number },
): Said {
  const state = view.estimate.estimate.state;
  const statePart =
    q.stateCents > 0 && state
      ? `, and about ${roundDollars(q.stateCents)} to ${stateName(state.code)}`
      : "";
  return {
    body: `Estimated tax is due ${dayLabel(q.date)}: about ${roundDollars(q.cents)} federal${statePart} for ${view.year}, by my estimate from your freelance income. It adds up to what I estimate you'll still owe. Pay it with IRS Direct Pay and tell me when it's done.`,
    actions: [
      { id: "tax.quarter_paid", label: "I've paid it", kind: "primary" },
      link("IRS Direct Pay", IRS_DIRECT_PAY_URL),
    ],
    refs: { advice: true, taxQuarter: q, taxYear: view.year },
  };
}

export function setAsideMessage(
  view: SelfEmployedView,
  payment: { payer: string; cents: number; setAsideCents: number },
): Said {
  const body = `${payment.payer} paid you ${formatCents(payment.cents)}. Set aside about ${roundDollars(payment.setAsideCents)} (${Math.round(view.setAsideRate * 100)}%) for its taxes, by my estimate.`;
  if (view.setAsideGoal) {
    return {
      body: `${body} Your "Taxes set aside for ${view.year}" goal is ready for it.`,
      actions: [link("See goals", "/goals")],
      refs: { advice: true },
    };
  }
  const last = view.federal.payments.at(-1)?.date ?? `${view.year + 1}-01-15`;
  const target = view.federal.owedCents + (view.state?.owedCents ?? 0);
  return {
    body: `${body} A goal would keep it apart.`,
    actions:
      target > 0
        ? [{ id: "goal.start", label: "Start a tax set-aside goal", kind: "primary" }]
        : [link("See goals", "/goals")],
    refs: {
      advice: true,
      ...(target > 0
        ? {
            goal: {
              name: `Taxes set aside for ${view.year}`,
              targetCents: target,
              targetDate: last,
            },
          }
        : {}),
    },
  };
}
