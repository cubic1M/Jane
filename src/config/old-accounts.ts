// Old accounts brought home (spec step 211, demo advice): forgotten 401(k)s found and
// rolled over. The records come from a plan locator (a stand-in until a plan-search partner
// or the Department of Labor's Retirement Savings Lost and Found is wired in). FOR REVIEW.

export const OLD_PLAN_LOCATOR = "demo";

// The steps of a direct rollover, in order. The money moves from the old plan to the new
// account itself (trustee to trustee): never a check made out to the person, so it is never
// a withdrawal and never taxed.
export const ROLLOVER_STEPS = [
  { key: "destination", label: "A rollover IRA is ready to receive it" },
  {
    key: "request",
    label: "Direct rollover requested from the old plan (the plan sends it, not you)",
  },
  { key: "arrives", label: "The old plan sends the money to your IRA" },
  { key: "invested", label: "Invested in your target mix" },
] as const;

// The stand-in plan takes this many days to send the money.
export const ROLLOVER_DAYS = 3;
// A direct rollover goes to a pre-tax account, so it isn't taxed: a Roth conversion would be.
export const ROLLOVER_NOTE =
  "A direct rollover to a traditional IRA isn't a withdrawal and isn't taxed. Moving it to a Roth IRA would be taxed, so Jane never does that for you.";

// Where to look for a plan the locator can't find.
export const LOOKUP_HELP = [
  "Ask the old employer's HR or benefits team who ran the plan.",
  "Search the Department of Labor's Retirement Savings Lost and Found (savings.dol.gov).",
  "Check old statements or tax forms (Form 1099-R) for the plan's name.",
] as const;

// Jane brings an old plan up only when the fees saved are at least this much a year (cents).
export const OLD_PLAN_MIN_SAVING_CENTS = 2_500;
