// The brokerage partner (spec step 133). Until a real brokerage and a registered adviser
// are connected, orders go to a simulation: filled on paper at the latest price, never with
// real money, and every screen that shows them says so (SIMULATED_NOTICE).

export const SIMULATED_PARTNER = "simulated";

export const SIMULATED_NOTICE =
  "Simulated brokerage: these orders are pretend. No real money moves and nothing is bought or sold.";

// Orders smaller than this aren't placed: not worth a trade.
export const MIN_ORDER_CENTS = 10_000;

// Real orders. Turning this on is a code change, never an env var, and needs a registered adviser, a
// brokerage contract and counsel. Stage 4 starts with recommendations, and has no real trading.
export const REAL_TRADING = false;
