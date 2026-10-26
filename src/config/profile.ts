// The picture of you (spec step 253): how Jane works out what it knows about a person.
// Thresholds and the confidence recipe live here, never inline.

export const PROFILE_MONTHS = 12;

// How sure Jane is of a fact (spec step 254's founder ask: a percentage worked out from the
// evidence, never made up). Told facts are the person's own word: sure. Seen and guessed
// facts start at a base, gain for each month of data and each clean match, up to a cap.
//
// The percentage has to help someone decide, so it spreads with the evidence: a fact clearly
// counted over many months is near 90–95%, one from a month or a single match is about
// 50–65%, and a guess is always below 50% (UNSURE_BELOW) and is worded "Jane isn't sure".
export const CONFIDENCE = {
  told: 100,
  seen: { base: 45, perMonth: 3, perMatch: 2, matchCap: 10, max: 95 },
  guessed: { base: 15, perMonth: 2, perMatch: 2, matchCap: 10, max: 49 },
} as const;
// Below this a percentage is said as "I'm not sure".
export const UNSURE_BELOW = 50;

// Income.
export const SALARY_DEPOSITS_MIN = 6;
export const UNEVEN_DEPOSITS_MIN = 3;
export const BUSINESS_DEPOSITS_MIN = 24;
export const PENSION_PATTERN =
  /SSA TREAS|SOCIAL SEC|PENSION|RETIREMENT SYSTEM|TEACHERS RETIREMENT/i;

// An employer that has paid in this many days is still an earner in the household.
export const EARNER_ACTIVE_DAYS = 45;

// Debt trouble (loans QA: it rests on the debts, not on fees): card debt of this many months of
// income, debt payments at step 229's share of income (src/config/debt-trouble.ts), or payday
// loans repaid at TROUBLE_PAYDAY_INCOME_SHARE of income. Overdraft and late fees are spending
// findings of their own.
export const TROUBLE_DEBT_MONTHS = 3;
// Payday loans and pay advances count when their repayments in the year are at least this share
// of a year's income: a cycle that eats the pay, not one small advance.
export const TROUBLE_PAYDAY_INCOME_SHARE = 0.05;

// Life stage.
export const STARTING_MAX_INCOME_CENTS = 400_000;
export const STARTING_MAX_SAVED_CENTS = 2_500_000;
export const APPROACHING_ASSETS_CENTS = 40_000_000;
export const APPROACHING_PAYOFF_YEARS = 8;
export const TOLD_AGE_STARTING_BELOW = 30;
export const TOLD_AGE_APPROACHING_FROM = 58;
export const TOLD_AGE_RETIRED_FROM = 66;
// The youngest age in each age band the person can pick (the band, not a made-up age, is what
// they told Jane; this is only what the life stage reads from it).
export const AGE_BAND_FROM: Readonly<Record<string, number>> = {
  under_30: 0,
  "30_to_49": 30,
  "50_to_57": 50,
  "58_to_65": 58,
  "66_to_72": 66,
  "73_plus": 73,
};

// Small recurring things seen in the year before Jane calls it a pet or a car.
export const PET_PURCHASES_MIN = 3;
