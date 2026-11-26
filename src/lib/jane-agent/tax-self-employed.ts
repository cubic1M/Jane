import { IRS_DIRECT_PAY_URL, QUARTERLY } from "@/config/tax";
import { formatCents, formatWholeDollars } from "@/lib/money";
import type { SelfEmployedView } from "@/lib/self-employed";
import { stateName } from "@/planning/tax-profile";
import { type MessageAction, type MessageRefs, openLink } from "./types";
import { DAY_MS } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";

// Freelancers in the chat (spec step 123): the next estimated tax payment, before it's due,
// with the amount; what to set aside from each payment. Demo advice, labelled.

export type Said = { body: string; actions: MessageAction[]; refs: MessageRefs };

// The next payment within QUARTERLY.remindDays of today, if any. The federal and the state plan
// are worked out apart, so owing the state alone (federal under the minimum) still reminds.
export function nextQuarter(view: SelfEmployedView, today: string) {
  if (!view.active) return null;
  const upcoming = (payments: { date: string; cents: number }[]) =>
    payments.find((p) => p.date >= today) ?? null;
  const federal = view.federal.needed ? upcoming(view.federal.payments) : null;
  const state = view.state?.needed ? upcoming(view.state.payments) : null;
  const date = [federal?.date, state?.date].filter((d): d is string => !!d).sort()[0];
  if (!date) return null;
  const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS;
  if (days > QUARTERLY.remindDays) return null;
  return {
    date,
    cents: federal?.date === date ? federal.cents : 0,
    stateCents: state?.date === date ? state.cents : 0,
  };
}

export function quarterMessage(
  view: SelfEmployedView,
  q: { date: string; cents: number; stateCents: number },
): Said {
  const state = view.estimate.estimate.state;
  const statePart =
    q.stateCents > 0 && state
      ? `, and about ${formatWholeDollars(q.stateCents)} to ${stateName(state.code)}`
      : "";
  const amounts =
    q.cents > 0
      ? `about ${formatWholeDollars(q.cents)} federal${statePart}`
      : `about ${formatWholeDollars(q.stateCents)} to ${state ? stateName(state.code) : "your state"}`;
  return {
    body: `Estimated tax is due ${dayLabel(q.date)}: ${amounts} for ${view.year}, by my estimate from your freelance income. It adds up to what I estimate you'll still owe. ${q.cents > 0 ? "Pay it with IRS Direct Pay and tell me when it's done." : "Pay it through your state's own page and tell me when it's done."}`,
    actions: [
      { id: "tax.quarter_paid", label: "I've paid it", kind: "primary" },
      ...(q.cents > 0 ? [openLink("IRS Direct Pay", IRS_DIRECT_PAY_URL)] : []),
    ],
    refs: { advice: true, taxQuarter: q, taxYear: view.year },
  };
}

export function setAsideMessage(
  view: SelfEmployedView,
  payment: { payer: string; cents: number; setAsideCents: number },
): Said {
  const body = `${payment.payer} paid you ${formatCents(payment.cents)}. Set aside about ${formatWholeDollars(payment.setAsideCents)} (${Math.round(view.setAsideRate * 100)}%) for its taxes, by my estimate.`;
  if (view.setAsideGoal) {
    return {
      body: `${body} Your "Taxes set aside for ${view.year}" goal is ready for it.`,
      actions: [openLink("See goals", "/goals")],
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
        : [openLink("See goals", "/goals")],
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
