// The buttons about loans and debt (spec Phase Y), registered in ./types.ts ACTION_IDS in
// one place; their handlers are ./actions/debt-handlers.ts.
export const DEBT_ACTION_IDS = [
  // Spec step 110: start the payoff plan in one order or the other.
  "debt_plan.avalanche",
  "debt_plan.snowball",
] as const;
