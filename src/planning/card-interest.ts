import { PAY_EARLY_DAYS, PROMO_PACE_SHARE, RATE_ASK_CUT_BPS } from "@/config/card-interest";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";

// Less interest on every card (spec step 224). Pure: what paying earlier saves, whether a
// 0% promotion is on pace to clear before its end (and what deferred interest would cost if
// not), and the request for a lower rate with what it saves a year.

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
export const daysBetween = (from: string, to: string) =>
  Math.round(dayNumber(to) - dayNumber(from));
const monthsBetween = (from: string, to: string) => {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
};

// Interest charged on `amountCents` for `days` days at a yearly rate (daily compounding is
// close enough to simple here: card interest is on the daily balance).
export const interestCents = (amountCents: number, aprBps: number, days: number) =>
  Math.round((amountCents * (aprBps / 10_000) * days) / 365);

// What paying `amountCents` now instead of on the due date saves in interest this cycle.
export function payEarlySaving(input: {
  amountCents: number;
  aprBps: number;
  asOf: string;
  dueOn: string;
}): { days: number; savedCents: number } {
  const days = Math.max(0, Math.min(daysBetween(input.asOf, input.dueOn), PAY_EARLY_DAYS * 3));
  return { days, savedCents: interestCents(input.amountCents, input.aprBps, days) };
}

export type PromoPlan = {
  daysLeft: number;
  monthsLeft: number;
  // What clears the balance by the end, a month.
  monthlyNeededCents: number;
  // What the person pays a month now.
  monthlyPaidCents: number;
  onPace: boolean;
  shortCents: number;
  // If the balance isn't cleared: deferred interest from the start at the go-to rate on what
  // is then unpaid (estimated), or the interest from the end on.
  costIfMissedCents: number;
  ended: boolean;
};

export function promoPlan(input: {
  balanceCents: number;
  startedOn: string;
  endsOn: string;
  goToAprBps: number;
  deferred: boolean;
  monthlyPaidCents: number;
  asOf: string;
}): PromoPlan {
  const daysLeft = daysBetween(input.asOf, input.endsOn);
  const ended = daysLeft <= 0;
  const monthsLeft = Math.max(1, monthsBetween(input.asOf, input.endsOn) + (daysLeft > 0 ? 0 : 1));
  const monthlyNeededCents = ended
    ? input.balanceCents
    : Math.ceil(input.balanceCents / monthsLeft);
  const onPace =
    input.balanceCents <= 0 || input.monthlyPaidCents >= monthlyNeededCents * PROMO_PACE_SHARE;
  // What would be left unpaid at the end at the current pace.
  const leftAtEnd = Math.max(0, input.balanceCents - input.monthlyPaidCents * monthsLeft);
  const costIfMissedCents = input.deferred
    ? interestCents(
        leftAtEnd,
        input.goToAprBps,
        Math.max(0, daysBetween(input.startedOn, input.endsOn)),
      )
    : interestCents(leftAtEnd, input.goToAprBps, 365);
  return {
    daysLeft,
    monthsLeft,
    monthlyNeededCents,
    monthlyPaidCents: input.monthlyPaidCents,
    onPace,
    shortCents: Math.max(0, monthlyNeededCents - input.monthlyPaidCents),
    costIfMissedCents,
    ended,
  };
}

export type RateAsk = {
  newAprBps: number;
  savingYearlyCents: number;
  body: string;
  script: string;
};

// The request for a lower rate, as a letter and as a call script, with what the cut saves
// a year on the card's balance.
export function rateAsk(input: {
  cardName: string;
  aprBps: number;
  balanceCents: number;
  onTimeMonths: number | null;
}): RateAsk {
  const newAprBps = Math.max(0, input.aprBps - RATE_ASK_CUT_BPS);
  const savingYearlyCents = interestCents(input.balanceCents, input.aprBps - newAprBps, 365);
  const apr = (input.aprBps / 100).toFixed(2);
  const history = input.onTimeMonths
    ? `I've paid on time for ${input.onTimeMonths} months and`
    : "I'd like to keep paying on time and";
  return {
    newAprBps,
    savingYearlyCents,
    body: `Hello, my account (${input.cardName}) is charged ${apr}% interest. ${history} I'd like to ask you to lower my rate. Please tell me what you can offer. Thank you.`,
    script: [
      `1. Call the number on the back of your ${input.cardName} card and say you'd like to ask about your interest rate.`,
      `2. Say: "My rate is ${apr}%. ${history} I'd like to ask for a lower rate."`,
      `3. If they say no, ask: "Is there a retention or hardship offer I qualify for?" and thank them either way.`,
      `4. A cut of ${(RATE_ASK_CUT_BPS / 100).toFixed(0)} points would save about ${formatCents(savingYearlyCents)} a year on today's balance.`,
    ].join("\n"),
  };
}

export const promoLine = (name: string, plan: PromoPlan, endsOn: string) =>
  plan.ended
    ? `${name}'s 0% ended on ${dayLabel(endsOn, { year: true })}.`
    : `${name}'s 0% ends on ${dayLabel(endsOn, { year: true })} (${plan.daysLeft} days): ${formatCents(plan.monthlyNeededCents)} a month clears it.`;
