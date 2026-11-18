import { describe, expect, it } from "vitest";
import { AS_OF, CHECKING, GROCERIES, input, tx } from "./__fixtures__/build";
import { checkup } from "./checkup";
import { addDays } from "./units";

// Debugger 11-18 (r346, four months of Chase checking that pays Nelnet, with one $14 "NELNET
// STUDENT LOAN LATE FEE", on a phone): the report's "Bank fees" check said "Refunded in full in 4
// months". Nothing was refunded: the late fee is the student loan's, which the bank-fee finding
// leaves to the late-fee suggestion, so the bank charged no fee at all.

function withLoanLateFee() {
  const transactions = [];
  for (let back = 120; back >= 3; back -= 6) {
    transactions.push(
      tx({ ...GROCERIES, accountId: CHECKING.id, date: addDays(AS_OF, -back), amountCents: 3_000 }),
    );
  }
  transactions.push(
    tx({
      accountId: CHECKING.id,
      date: addDays(AS_OF, -70),
      amountCents: 1_400,
      description: "NELNET STUDENT LOAN LATE FEE",
      merchantName: null,
      pfcPrimary: "BANK_FEES",
      pfcDetailed: "BANK_FEES_LATE_FEES",
    }),
  );
  return input({ accounts: [{ ...CHECKING, currentBalanceCents: 300_000 }], transactions });
}

const line = (data: ReturnType<typeof input>) =>
  checkup(data).find((l) => l.label === "Bank fees")?.line;

describe("the bank fees check beside a loan's late fee", () => {
  it("says there were none, not that they were refunded", () => {
    expect(line(withLoanLateFee())).toMatch(/^None in /);
  });
});
