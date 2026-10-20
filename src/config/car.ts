// Buying a car (spec step 178): what a person can afford, with insurance and running costs
// in, and how loan offers and a dealer's financing compare. Demo advice.

// All-in monthly cost of a car (payment, insurance, fuel, upkeep, registration) at most this
// share of monthly income: the common 20% guideline.
export const CAR_COST_MAX_SHARE = 0.2;
export const CAR_COST_SOURCE = "https://www.consumerfinance.gov/consumer-tools/auto-loans/";

export const CAR_TERMS_MONTHS = [36, 48, 60, 72] as const;
export const CAR_DEFAULT_TERM_MONTHS = 60;
// A down payment of this share of the price unless the person says otherwise.
export const CAR_DOWN_PAYMENT_SHARE = 0.1;

// Running costs, as shares of the price a year, when the person's own aren't known.
export const CAR_MAINTENANCE_YEARLY_SHARE = 0.015;
export const CAR_REGISTRATION_YEARLY_SHARE = 0.008;
// Insurance: with no auto policy yet, this share of the price a year; with one, the
// current premium scaled by (price / the current car's value) to this power.
export const CAR_INSURANCE_DEFAULT_YEARLY_SHARE = 0.04;
export const CAR_INSURANCE_ELASTICITY = 0.5;
// The value of the car the current premium covers when the person hasn't added one.
export const CAR_REFERENCE_VALUE_CENTS = 2_500_000;

// The top of the price search, and its step.
export const CAR_MAX_PRICE_CENTS = 15_000_000;
export const CAR_PRICE_STEP_CENTS = 50_000;

// A dealer's financing more than this many basis points over the best preapproval's rate
// is flagged; one that costs less overall isn't.
export const CAR_DEALER_FLAG_BPS = 100;
// Months of gas spending that set the fuel cost.
export const CAR_FUEL_MONTHS = 3;
