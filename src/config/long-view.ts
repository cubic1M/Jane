// The long view (spec step 209): where the money is heading over decades. Rates for
// investments and inflation are the investment pages' own (src/config/market-assumptions.ts);
// these are the others. Every one is shown to the person and can be changed on /long-view.
// A range, never one number and never a promise.

// Years shown.
export const LONG_VIEW_HORIZONS = [10, 20, 30] as const;
// Yearly growth of cash after inflation: savings accounts roughly keep up with prices.
export const CASH_REAL_GROWTH = 0;
export const CASH_REAL_GROWTH_SOURCE = "Savings roughly keep pace with inflation";
// Yearly growth of a home's value after inflation (long-run US house prices have risen a
// little faster than prices).
export const HOME_REAL_GROWTH = 0.01;
export const HOME_REAL_GROWTH_SOURCE =
  "Long-run US house prices have risen about 1% a year faster than prices";
// What was paid on a debt goes to investing once it is paid off.
export const ROLL_FREED_PAYMENTS = true;
// Things owned that grow like a home (the rest, like a car, are held at today's value).
export const GROWING_ASSET_KINDS: readonly string[] = ["home", "property"];
// The "what moves it most" tests: each of these monthly amounts, in cents.
export const LEVER_MONTHLY_CENTS = 10_000;
// A saving rate reached on this share of margin is the default when contributions are unknown.
export const DEFAULT_INVEST_SHARE_OF_MARGIN = 0.5;
// The most that an edited assumption may be.
export const MAX_RETURN = 0.15;
export const MAX_EXTRA_MONTHLY_CENTS = 1_000_000;
