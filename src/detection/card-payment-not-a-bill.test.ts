import { describe, expect, it } from "vitest";
import { CARD, CHECKING, NETFLIX, input, monthly } from "./__fixtures__/build";
import { recurringCharges } from "./subscriptions";

// Debugger 11-12: a student's /subscriptions listed "Credit card payment, $850.00 monthly" under
// "Other regular bills", beside the purchases made on that same card. Paying a card on file only
// moves money: it was left out when the payment named a big issuer ("CHASE CREDIT CRD AUTOPAY"),
// but not for a card the issuer list doesn't know (the demo bank's, a credit union's), even with
// the card's own side showing each payment arriving.

const CARD_PAYMENT = {
  merchantName: null,
  pfcPrimary: "LOAN_PAYMENTS",
  pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
} as const;
const unionCard = { ...CARD, id: "acct_ccu", name: "Campus Credit Union Visa" };
const paid = monthly(4, 85_000, {
  ...CARD_PAYMENT,
  accountId: CHECKING.id,
  description: "PAYMENT TO CCU VISA",
});
const arrived = monthly(4, -85_000, {
  ...CARD_PAYMENT,
  accountId: unionCard.id,
  description: "PAYMENT THANK YOU",
});
const bought = monthly(4, 1549, { ...NETFLIX, accountId: unionCard.id });

describe("paying a card that's on file, whoever issued it", () => {
  it("isn't a bill when the card shows each payment arriving", () => {
    const rows = recurringCharges(
      input({ accounts: [CHECKING, unionCard], transactions: [...paid, ...arrived, ...bought] }),
    );
    expect(rows.map((r) => r.merchant)).toEqual([NETFLIX.merchantName]);
  });

  it("is still listed when no card on file shows it arriving: it's the only sign of that spending", () => {
    const rows = recurringCharges(
      input({ accounts: [CHECKING, unionCard], transactions: [...paid, ...bought] }),
    );
    expect(rows.map((r) => r.merchant)).toContain("Credit card payment");
  });
});
