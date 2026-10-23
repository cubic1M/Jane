import { ESTIMATED_TAX_DATES } from "./tax-pack";

// The year-round tax plan (spec step 167): each tax move, when Jane brings it up and its
// deadline. FOR REVIEW, like src/config/tax-rates.ts. Dates are MM-DD of the tax year, or
// of the year after it (nextYear). A move is never offered past its deadline.
//
// Sources: workplace plan contributions go through payroll by Dec 31; IRA and HSA
// contributions for a year can be made until that year's filing deadline (IRS Pub 590-A,
// Pub 969); estimated payments are due Apr 15, Jun 15, Sep 15 and Jan 15 (IRS Form 1040-ES);
// gifts and sales count in the year they're made (Dec 31); open enrollment usually ends in
// November (employers vary, ESTIMATE TO VERIFY); the IRS suggests checking a W-4 after a
// life change (irs.gov/w4).

export type PlanDate = { md: string; nextYear: boolean };

export type PlanMoveKey =
  | "workplace_retirement"
  | "ira"
  | "hsa"
  | "fsa_enroll"
  | "estimated_1"
  | "estimated_2"
  | "estimated_3"
  | "estimated_4"
  | "harvest"
  | "giving"
  | "w4_life_event"
  | "file";

export type PlanMoveRule = {
  title: string;
  // Recommendations (contributions, sales, gifts) are demo advice; reminders of a date
  // aren't.
  advice: boolean;
  // When Jane brings it up, and its deadline. A life-event W-4 check opens on the event
  // and is due W4_AFTER_EVENT_DAYS later instead.
  opens: PlanDate;
  deadline: PlanDate;
  // It has its own message elsewhere (step 123's quarterly reminder, step 126's filing),
  // so the plan doesn't post another; it's still on the calendar and the deadlines.
  ownMessage?: true;
};

// An estimated payment's dates, from the IRS dates kept once in ./tax-pack.ts: due on the date,
// brought up from the 1st of its month.
function estimateDates(n: number): { opens: PlanDate; deadline: PlanDate } {
  const { month, day, nextYear } = ESTIMATED_TAX_DATES[n];
  const mm = String(month).padStart(2, "0");
  return {
    opens: { md: `${mm}-01`, nextYear },
    deadline: { md: `${mm}-${String(day).padStart(2, "0")}`, nextYear },
  };
}

export const TAX_PLAN: Readonly<Record<PlanMoveKey, PlanMoveRule>> = {
  workplace_retirement: {
    title: "Put more into your 401(k) before your last paycheck",
    advice: true,
    opens: { md: "09-01", nextYear: false },
    deadline: { md: "12-31", nextYear: false },
  },
  ira: {
    title: "Make your IRA contribution",
    advice: true,
    opens: { md: "10-01", nextYear: false },
    deadline: { md: "04-15", nextYear: true },
  },
  hsa: {
    title: "Top up your HSA",
    advice: true,
    opens: { md: "10-01", nextYear: false },
    deadline: { md: "04-15", nextYear: true },
  },
  fsa_enroll: {
    title: "Sign up for an FSA at open enrollment",
    advice: true,
    opens: { md: "10-15", nextYear: false },
    deadline: { md: "11-30", nextYear: false },
  },
  estimated_1: {
    title: "Pay the first estimated tax payment",
    advice: false,
    ...estimateDates(0),
    ownMessage: true,
  },
  estimated_2: {
    title: "Pay the second estimated tax payment",
    advice: false,
    ...estimateDates(1),
    ownMessage: true,
  },
  estimated_3: {
    title: "Pay the third estimated tax payment",
    advice: false,
    ...estimateDates(2),
    ownMessage: true,
  },
  estimated_4: {
    title: "Pay the last estimated tax payment",
    advice: false,
    ...estimateDates(3),
    ownMessage: true,
  },
  harvest: {
    title: "Sell at a loss before the year ends",
    advice: true,
    opens: { md: "10-01", nextYear: false },
    deadline: { md: "12-31", nextYear: false },
  },
  giving: {
    title: "Make this year's gifts before December 31",
    advice: true,
    opens: { md: "11-01", nextYear: false },
    deadline: { md: "12-31", nextYear: false },
  },
  w4_life_event: {
    title: "Check your W-4 after your life change",
    advice: false,
    opens: { md: "01-01", nextYear: false },
    deadline: { md: "12-31", nextYear: false },
  },
  file: {
    title: "File your return",
    advice: false,
    opens: { md: "01-20", nextYear: true },
    deadline: { md: "04-15", nextYear: true },
    ownMessage: true,
  },
};

// The calendar's order within a deadline.
export const PLAN_ORDER: readonly PlanMoveKey[] = Object.keys(TAX_PLAN) as PlanMoveKey[];

// A W-4 check is due this many days after a new job or a new baby.
export const W4_AFTER_EVENT_DAYS = 30;
export const W4_LIFE_EVENTS = ["new_job", "new_baby"] as const;
