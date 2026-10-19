// The buttons about loans and debt (spec Phase Y), registered in ./types.ts ACTION_IDS in
// one place; their handlers are ./actions/debt-handlers.ts.
export const DEBT_ACTION_IDS = [
  // Spec step 110: start the payoff plan in one order or the other.
  "debt_plan.avalanche",
  "debt_plan.snowball",
  // Spec step 112: prepare the application for an offer, submit it after reviewing the
  // terms, accept the approved loan, or don't apply.
  "loan.prepare",
  "loan.submit",
  "loan.accept",
  "loan.withdraw",
  // Spec step 113: the person moved a card's balance to a 0% card, or paid it off.
  "transfer.start",
  "transfer.done",
  // Spec step 114: a studentaid.gov step done; on to the next.
  "student.next",
  // Spec step 174: apply for the card Jane found (a hard credit check, only on this tap).
  "credit_card.apply",
] as const;
