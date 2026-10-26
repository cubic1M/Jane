import { HOME_GOAL_NAME } from "@/config/home-buying";
import { formatRate } from "@/insights/loans";
import { dayLabel } from "@/lib/day-label";
import type { HomeBuying } from "@/lib/home-buying";
import { homeMeasureOf, homeVsBorrowClause } from "@/planning/home-vs-borrow";
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

const noIncome: Reply = {
  body: "I need a few months of income to see before I can say what home you can afford. Once your paychecks show, I'll work it out.",
  actions: [],
  refs: {},
};

// `mortgageCents`: what "what could I borrow?" shows for a mortgage, so the two sizes are said
// together (src/planning/home-vs-borrow.ts).
export function homeReply(
  home: HomeBuying,
  asked: boolean,
  mortgageCents: number | null = null,
): Reply {
  if (!home.available || !home.costs || !home.affordability || !home.saving) return noIncome;
  const c = home.costs;
  const allowed = home.affordability.allowedHousingCents;
  const s = home.saving;
  const by = dayLabel(home.targetDate, { year: true });
  const first = asked
    ? `A ${formatCents(c.priceCents)} home would cost about ${formatCents(c.housingCents)} a month with taxes and insurance, ${c.housingCents <= allowed ? "within" : "over"} the ${formatCents(allowed)} the usual 28/36 rules allow for you.`
    : home.advice
      ? `You can afford a home up to about ${formatCents(home.affordability.maxPriceCents)}: ${formatCents(c.housingCents)} a month with taxes and insurance, within the ${formatCents(allowed)} the usual 28/36 rules allow for you.`
      : `The usual 28/36 rules allow a home up to about ${formatCents(home.affordability.maxPriceCents)} for you: ${formatCents(c.housingCents)} a month with taxes and insurance, within the ${formatCents(allowed)} they allow.`;
  // What you could borrow measures it another way: said in the same sentence, with why.
  const other = homeVsBorrowClause(homeMeasureOf(home), mortgageCents);
  const second = `That assumes ${Math.round(home.downShare * 100)}% down (${formatCents(c.downCents)}) on a 30-year loan at ${formatRate(home.aprBps ?? 0)}${home.rateIsOffer ? "" : ", a typical rate rather than an offer"}, so about ${formatCents(c.cashNeededCents)} up front with closing costs${other ? `; ${other}` : ""}.`;
  const third =
    s.stillNeededCents === 0
      ? "You have that saved already."
      : s.onTrack
        ? `You have ${formatCents(home.savedCents)} saved and keep about ${formatCents(home.monthlySavingCents)} a month, so you'd have it by ${by}.`
        : `You have ${formatCents(home.savedCents)} saved; putting away ${formatCents(s.monthlyNeededCents)} a month gets you there by ${by}.`;
  const canStart = !home.hasGoal && s.stillNeededCents > 0;
  return {
    body: [first, second, third].join(" "),
    actions: canStart ? [goalButton(c.cashNeededCents), HOME_PAGE] : [HOME_PAGE],
    refs: {
      ...(home.advice ? { advice: true } : {}),
      ...(canStart ? { homeGoal: { priceCents: c.priceCents } } : {}),
    },
  };
}

export const HOME_GOAL = HOME_GOAL_NAME;
