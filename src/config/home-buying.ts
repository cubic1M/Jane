// Buying a home (spec step 179): affordability, the down payment and closing costs, and
// saving for them. Demo advice; every assumption here is shown to the person.

// The usual lender rules: housing at most 28% of gross income, all debt payments at most
// 36%. Their take-home is turned into gross income with one stated assumption.
export const HOME_MAX_HOUSING_SHARE = 0.28;
export const HOME_MAX_DEBT_SHARE = 0.36;
export const HOME_NET_TO_GROSS = 0.78;
export const HOME_RULES_SOURCE = "https://www.consumerfinance.gov/owning-a-home/";

export const HOME_TERM_MONTHS = 360;
// A typical 30-year fixed rate, used to work out affordability when no lender partner gives a
// real offer. Stated next to every figure that uses it; it is not an offer.
export const HOME_DEFAULT_APR_BPS = 650;
export const HOME_DEFAULT_DOWN_SHARE = 0.1;
// Under this share down, private mortgage insurance is added (see src/config/debt.ts).
export const HOME_PMI_BELOW_DOWN_SHARE = 0.2;

// As shares of the price a year.
export const HOME_PROPERTY_TAX_YEARLY_SHARE = 0.011;
export const HOME_INSURANCE_YEARLY_SHARE = 0.0035;
// On the loan, while the down payment is under HOME_PMI_BELOW_DOWN_SHARE.
export const HOME_PMI_YEARLY_SHARE = 0.007;
export const HOME_CLOSING_COSTS_SHARE = 0.03;

export const HOME_MAX_PRICE_CENTS = 200_000_000;
export const HOME_PRICE_STEP_CENTS = 500_000;
// The date the down payment is wanted by, when the person hasn't said.
export const HOME_DEFAULT_SAVE_MONTHS = 24;
export const HOME_GOAL_NAME = "Home down payment";
