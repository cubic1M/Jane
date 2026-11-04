// --- Cash-flow forecast (low balance ahead) ----------------------------------------

// How far ahead the forecast looks: a month, including the same date next month.
export const FORECAST_DAYS = 31;
// A balance from an uploaded statement that ends at most this many days before today is walked
// forward to today with what was due in between (a paycheck, a bill) before the forecast starts;
// an older one isn't (its statements describe then, src/lib/report-state.ts).
export const BALANCE_ROLL_MAX_DAYS = 35;
// A checking account forecast to dip below this before more income arrives is a risk.
// A deposit this big from a name that sounds like a cafe or a salon is a client paying, not a
// refund: nothing bought there costs that much (src/categorize/rules.ts).
export const NOT_A_REFUND_MIN_CENTS = 50_000;
export const NOT_A_REFUND_PRIMARIES: readonly string[] = [
  "FOOD_AND_DRINK",
  "PERSONAL_CARE",
  "ENTERTAINMENT",
];
export const LOW_BALANCE_CUSHION_CENTS = 10_000;
// Pay at uneven times has no date to forecast (src/detection/forecast.ts, unevenPay): at least this
// many deposits and this much a month, over the last this many days, with no payday expected.
export const UNEVEN_PAY_LOOKBACK_DAYS = 90;
export const UNEVEN_PAY_LOOKBACK_MONTHS = 3;
export const UNEVEN_PAY_NOT_PAY: readonly string[] = ["INCOME_INTEREST_EARNED", "INCOME_DIVIDENDS"];
export const UNEVEN_PAY_MIN_DEPOSITS = 2;
export const UNEVEN_PAY_MIN_MONTHLY_CENTS = 50_000;
// Deposits this close together on average can be counted on to come again that soon, though not on
// which day; further apart, the next one is too uncertain to count bills only up to it.
export const UNEVEN_PAY_STEADY_GAP_DAYS = 14;
// Below zero is high confidence; between zero and the cushion is medium.
export const LOW_BALANCE_HIGH_CONFIDENCE_BELOW_CENTS = 0;
// Plaid depository subtypes the forecast runs for.
export const FORECAST_SUBTYPES: readonly string[] = ["checking"];
