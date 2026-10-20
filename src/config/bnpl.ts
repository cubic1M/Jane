// Buy now, pay later under control (spec step 176): every installment in the forecast and
// in safe to spend, a warning before a new plan would strain the month, and paying off
// early when it's free.

// A new "Pay in 4" plan: four payments two weeks apart, the first today.
export const NEW_PLAN_INSTALLMENTS = 4;
export const NEW_PLAN_EVERY_DAYS = 14;
// An installment already in the forecast (same amount within this many cents, this many
// days apart) isn't counted twice.
export const INSTALLMENT_MATCH_CENTS = 200;
export const INSTALLMENT_MATCH_DAYS = 3;
// Checking keeps at least this much after a payoff paid early.
export const PAYOFF_CUSHION_CENTS = 50_000;
// Where the rule that Pay in 4 plans charge no interest or fee for paying early comes from.
export const BNPL_EARLY_PAYOFF_SOURCE =
  "https://www.consumerfinance.gov/data-research/research-reports/consumer-use-of-buy-now-pay-later/";
