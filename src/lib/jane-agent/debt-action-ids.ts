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
  // Spec step 175: pay before a card's statement closes; open a credit-builder stand-in.
  "credit_build.pay",
  "credit_builder.open",
  // Spec step 176: pay a buy now, pay later plan off early when that's free.
  "bnpl.payoff",
  // Spec step 177: send one prepared request when money is tight.
  "tight.send",
  // Spec step 179: start the home down payment goal.
  "home.goal",
  // Spec step 180: send one prepared request about a medical bill.
  "medical.send",
  // Spec step 181: send one validation letter or bureau dispute.
  "creditfix.send",
  // Spec step 224: ask one card for a lower rate.
  "cardrate.send",
  // Spec step 226: whether a payment-app transfer was a loan.
  "famloan.yes",
  "famloan.no",
] as const;
