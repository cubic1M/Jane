// Saving for irregular costs (spec step 70): yearly and irregular bills become a monthly
// amount to set aside. Math from the person's own data, never advice.

// Streams charged less often than monthly, as Plaid or our fallback detect them.
export const IRREGULAR_STREAM_FREQUENCIES: readonly string[] = ["QUARTERLY", "ANNUALLY"];

// Our own pattern for bills twice a year: 2+ charges at one merchant, amounts within the
// stream tolerance, every gap inside this day range.
export const SEMIANNUAL_INTERVAL_DAYS: readonly [min: number, max: number] = [168, 198];
// And once a year, when the data runs long enough to see two charges.
export const YEARLY_INTERVAL_DAYS: readonly [min: number, max: number] = [340, 390];
// A semiannual or yearly pattern is still running if its last charge is within this many
// of its usual gaps from today.
export const IRREGULAR_ACTIVE_WITHIN_INTERVALS = 1.25;

// With only a year of data a yearly bill shows up once. A single charge counts when its
// category or merchant name says it's the yearly kind (car registration, licences)...
export const YEARLY_BILL_CATEGORIES: readonly string[] = [
  "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES",
];
// ...as whole words of the normalized merchant key...
export const YEARLY_BILL_PHRASES: readonly string[] = [
  "dmv",
  "motor vehicle",
  "motor vehicles",
  "vehicle registration",
  "registration renewal",
  "annual fee",
  "annual membership",
  "annual plan",
];
// ...and it's at least this much (in cents).
export const YEARLY_BILL_MIN_CENTS = 2_500;

// Never bills to set aside for: money moving between accounts, loan and card payments,
// income.
export const IRREGULAR_EXCLUDED_PRIMARIES: readonly string[] = [
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "LOAN_DISBURSEMENTS",
];
// Never anything from these account types.
export const IRREGULAR_EXCLUDED_ACCOUNT_TYPES: readonly string[] = ["loan", "investment"];

// Seasonal spending: in these months (1 = January), spending in these Plaid primary
// categories well above the category's usual month is a yearly cost too.
export const SEASONS: readonly {
  key: string;
  name: string;
  primaries: readonly string[];
  months: readonly number[];
}[] = [
  {
    key: "holiday_gifts",
    name: "Holiday gifts",
    primaries: ["GENERAL_MERCHANDISE"],
    months: [11, 12],
  },
];
// A season month counts when its spending is at least this many times the usual month
// (the median of the other complete months)...
export const SEASONAL_SPIKE_RATIO = 1.5;
// ...and the extra over the usual months adds up to at least this much (in cents)...
export const SEASONAL_MIN_EXTRA_CENTS = 10_000;
// ...with at least this many usual months to compare against.
export const SEASONAL_MIN_USUAL_MONTHS = 6;

// The monthly set-aside is the yearly total / 12, rounded up to whole dollars of this size.
export const SET_ASIDE_ROUNDING_CENTS = 100;

// The savings goal Jane proposes for it: this many months of the monthly total, reached
// this many months from now. A goal whose name matches already covers it.
export const YEARLY_BILLS_GOAL_NAME = "Yearly bills";
export const YEARLY_BILLS_GOAL_MONTHS = 12;
export const YEARLY_BILLS_GOAL_PATTERN = /yearly bills|irregular|annual bills/i;
