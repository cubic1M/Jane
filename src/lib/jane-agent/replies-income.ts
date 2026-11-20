import { PAYCHECKS_PER_MONTH } from "@/config/detection";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import type { PayOnSchedule } from "@/profile/pay-on-schedule";
import type { Reply } from "./replies";
import { openLink } from "./types";

// "How much do I make a month?" and "a year?" without Claude (the walkers' backup chat left both
// unanswered, phone passes 5 to 7). The month is the profile's monthly income, the figure the cards
// and /figures/monthly_income give; the year before tax is the tax cards' (yearIncomeOf): one
// figure each, wherever it's said (class 4, src/sweep/invariants.ts). Pure.

export type IncomeFacts = {
  // The profile's monthly income, take-home; null when no regular income is seen.
  monthCents: number | null;
  // They told Jane what they earn.
  told: boolean;
  // Pay on a schedule behind the month (src/profile/pay-on-schedule.ts).
  schedules: readonly PayOnSchedule[];
  // Months of data the figure is from.
  months: number;
  // The year before tax as the tax cards read it; 0 when not known.
  yearGrossCents: number;
  // Where the statements end, when that's too long ago to say what comes in now.
  statementsEnd: string | null;
};

const PAID: Record<PayOnSchedule["frequency"], string> = {
  WEEKLY: "every week",
  BIWEEKLY: "every two weeks",
  SEMI_MONTHLY: "twice a month",
  MONTHLY: "once a month",
};
// Under this much data a month's figure is an estimate.
const ESTIMATE_UNDER_MONTHS = 3;

export function incomeReply(period: "month" | "year", facts: IncomeFacts): Reply {
  const actions = [openLink("See how it's worked out", "/figures/monthly_income")];
  const { monthCents, told, schedules, months, yearGrossCents, statementsEnd } = facts;
  if (monthCents === null || monthCents <= 0) {
    return {
      body: statementsEnd
        ? `I don't see regular pay in your statements, which end ${dayLabel(statementsEnd)}, so I can't say what you make.`
        : "I don't see regular pay coming in yet, so I can't say what you make. Once a paycheck has come in a few times, I will.",
      actions: [openLink("See today", "/home")],
      refs: {},
    };
  }
  const month = formatCents(monthCents);
  const pay = schedules
    .map((s) => `${formatCents(s.paycheckCents)} ${PAID[s.frequency]} from ${s.employer}`)
    .join(" and ");
  const source = pay
    ? `${pay}, ${schedules.map((s) => Math.round(PAYCHECKS_PER_MONTH[s.frequency] * 12)).join(" and ")} paychecks a year`
    : "what comes in regularly";
  const when = statementsEnd
    ? ` That's from your statements, which end ${dayLabel(statementsEnd)}.`
    : months < ESTIMATE_UNDER_MONTHS
      ? ` It's from ${months === 1 ? "1 month" : `${months} months`} of data, so it's an estimate.`
      : "";
  const gross =
    yearGrossCents > 0
      ? `, about ${formatCents(yearGrossCents)} before tax, the figure the tax cards use`
      : "";
  if (told) {
    return {
      body:
        period === "month"
          ? `You told me you take home ${month} a month, so that's what I use.`
          : `You told me you take home ${month} a month: ${formatCents(monthCents * 12)} a year${gross}.`,
      actions,
      refs: {},
    };
  }
  const body =
    period === "month"
      ? `You take home about ${month} a month: ${source}.${when}`
      : `You take home about ${formatCents(monthCents * 12)} a year (${month} a month: ${source})${gross}.${when}`;
  return { body, actions, refs: {} };
}
