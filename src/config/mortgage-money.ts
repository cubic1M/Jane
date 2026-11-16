// Recast, refinance or pay extra (spec step 246): what to do with a lump sum or extra monthly
// money on a mortgage. Fees and rules live here with where they come from.

// A servicer's recast fee: typically a few hundred dollars (the CFPB and servicers' own pages).
export const RECAST_FEE_CENTS = 25_000;
// Most servicers want at least this much paid in at once to recast.
export const RECAST_MIN_LUMP_CENTS = 1_000_000;
export const RECAST_NOTE =
  "A recast keeps your rate and your end date and lowers the payment after you pay a lump sum. Many servicers offer it only on conventional loans; FHA and VA loans generally can't be recast.";
// Money put in this much or more is worth comparing.
export const MORTGAGE_MONEY_MIN_CENTS = 100_000;
export const MORTGAGE_MONEY_MAX_CENTS = 500_000_000;
export const MORTGAGE_EXTRA_MONTHLY_MIN_CENTS = 2_500;
export const MORTGAGE_EXTRA_MONTHLY_MAX_CENTS = 10_000_000;
// Investing is compared over the loan's remaining life, capped at this many years.
export const INVEST_COMPARE_MAX_YEARS = 30;
