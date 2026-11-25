import { describe, expect, it } from "vitest";
import { CARD, CHECKING, NETFLIX, input, monthly, tx } from "./__fixtures__/build";
import { recurringCharges } from "./subscriptions";

// A card payment is dropped from the bills only where what was bought on the card is counted:
// purchases on file, and the payment identified as that card's.
const autopay = monthly(4, 164_000, {
  description: "CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224",
  merchantName: null,
  pfcPrimary: "LOAN_PAYMENTS",
  pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
});
const merchants = (data: Parameters<typeof recurringCharges>[0]) =>
  recurringCharges(data).map((r) => r.merchant);

describe("paying a card with no purchases on file", () => {
  const sapphire = { ...CARD, id: "acct_sapphire", name: "Chase Sapphire" };
  // The card's own side shows only the payments arriving, no purchases.
  const arrivals = autopay.map((p) =>
    tx({
      accountId: sapphire.id,
      date: p.date,
      amountCents: -p.amountCents,
      description: "PAYMENT THANK YOU",
      merchantName: null,
      pfcPrimary: "LOAN_PAYMENTS",
      pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    }),
  );

  it("keeps the payment: it is the only sign of that spending", () => {
    const data = input({ accounts: [CHECKING, sapphire], transactions: [...autopay, ...arrivals] });
    expect(merchants(data)).toEqual(["Chase Sapphire payment"]);
  });
});

describe("paying one of two cards from the same issuer", () => {
  const sapphire = { ...CARD, id: "acct_sapphire", name: "Chase Sapphire" };
  const freedom = { ...CARD, id: "acct_freedom", name: "Chase Freedom" };

  it("keeps the payment when it can't be told which card it paid", () => {
    const data = input({
      accounts: [CHECKING, sapphire, freedom],
      // Only the Sapphire has purchases on file.
      transactions: [...autopay, ...monthly(4, 1549, { ...NETFLIX, accountId: sapphire.id })],
    });
    expect(merchants(data).filter((m) => /payment/.test(m))).toHaveLength(1);
  });

  it("still leaves out paying the one card of that issuer that's on file", () => {
    const data = input({
      accounts: [CHECKING, sapphire],
      transactions: [...autopay, ...monthly(4, 1549, { ...NETFLIX, accountId: sapphire.id })],
    });
    expect(merchants(data)).toEqual([NETFLIX.merchantName]);
  });
});
