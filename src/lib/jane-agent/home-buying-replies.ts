import { HOME_GOAL_NAME } from "@/config/home-buying";
import { formatRate } from "@/insights/loans";
import { dayLabel } from "@/lib/day-label";
import type { HomeBuying } from "@/lib/home-buying";
import { formatCents } from "@/lib/money";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about buying a home (spec step 179), from src/lib/home-buying.ts. Pure.
// Demo advice, labelled; every assumption is on the page.

export const HOME_PAGE: MessageAction = {
  id: "open",
  label: "Plan a home purchase",
  kind: "link",
  href: "/loans/home",
};

export const goalButton = (cents: number): MessageAction => ({
  id: "home.goal",
  label: `Start a ${formatCents(cents)} down payment goal`,
  kind: "primary",
});

const unavailable: Reply = {
  body: "Mortgage offers come from a lending partner, and there isn't one for your accounts yet, so I can't plan a home purchase yet.",
  actions: [],
  refs: {},
};

const noIncome: Reply = {
  body: "I need a few months of income to see before I can say what home you can afford. Once your paychecks show, I'll work it out.",
  actions: [],
  refs: {},
};

const months = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

export function homeReply(home: HomeBuying, asked: boolean): Reply {
  if (!home.available || home.offers.length === 0) return unavailable;
  if (home.missing === "income" || !home.costs || !home.affordability || !home.saving) {
    return noIncome;
  }
  const c = home.costs;
  const allowed = home.affordability.allowedHousingCents;
  const lines = [
    asked
      ? `A ${formatCents(c.priceCents)} home would cost about ${formatCents(c.housingCents)} a month, ${c.housingCents <= allowed ? "within" : "over"} the ${formatCents(allowed)} the usual 28/36 rules allow for you.`
      : `You can afford a home up to about ${formatCents(home.affordability.maxPriceCents)}: ${formatCents(c.housingCents)} a month, within the ${formatCents(allowed)} the usual 28/36 rules allow for you.`,
    `That's ${formatCents(c.principalAndInterestCents)} for the loan, ${formatCents(c.propertyTaxCents)} property tax, ${formatCents(c.insuranceCents)} insurance${c.pmiCents ? ` and ${formatCents(c.pmiCents)} mortgage insurance (PMI)` : ""}.`,
  ];
  if (c.pmiCents) {
    lines.push(
      "PMI is insurance for the lender while you put down under 20%; it comes off once you owe 80% of the home's value or less, which I'll watch for you.",
    );
  }
  const s = home.saving;
  const by = dayLabel(home.targetDate, { year: true });
  lines.push(
    `You'd need ${formatCents(c.cashNeededCents)} up front (${formatCents(c.downCents)} down and about ${formatCents(c.closingCents)} closing costs). ${
      s.stillNeededCents === 0
        ? "You have that saved already."
        : s.onTrack
          ? `You have ${formatCents(home.savedCents)} and keep about ${formatCents(home.monthlySavingCents)} a month, so you'd have it by ${by}.`
          : `You have ${formatCents(home.savedCents)}; to have it by ${by} you'd save ${formatCents(s.monthlyNeededCents)} a month${s.monthsAtCurrentPace ? `, and at your current ${formatCents(home.monthlySavingCents)} a month it takes ${months(s.monthsAtCurrentPace)}` : ", and you're not saving anything a month now"}.`
    }`,
  );
  const best = home.offers[0];
  lines.push(
    `The cheapest mortgage offer is ${best.offer.lender} at ${formatRate(best.offer.aprBps)}: ${formatCents(best.monthlyCents)} a month for the loan, ${formatCents(best.totalCents)} in all over 30 years, closing costs in (${best.offer.feeLabel.toLowerCase()}).`,
  );
  const canStart = !home.hasGoal && s.stillNeededCents > 0;
  return {
    body: lines.join("\n"),
    actions: canStart ? [goalButton(c.cashNeededCents), HOME_PAGE] : [HOME_PAGE],
    refs: canStart ? { advice: true, homeGoal: { priceCents: c.priceCents } } : { advice: true },
  };
}

export const HOME_GOAL = HOME_GOAL_NAME;
