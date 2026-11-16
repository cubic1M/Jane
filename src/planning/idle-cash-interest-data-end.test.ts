import { describe, expect, it } from "vitest";
import { payingCardInterest } from "./idle-cash";

// Gate C's calendar sweep, 11-16: whether a card is charging interest was counted back from today.
// With a bank that hadn't synced for two months, the card's last charges fell out of the window,
// so "more cash than you need, while a card charges interest" became "earn $489 a year" with no
// new data. It now counts back from where the data ends, as the rest of idle cash does.

// A card charging interest each month through Jan 10; the data ends Jan 14.
const transactions = [
  ...["2027-11-10", "2027-12-10", "2028-01-10"].map((date) => ({
    date,
    amountCents: 2_400,
    accountId: "card",
    pfc: "BANK_FEES_INTEREST_CHARGE",
    description: "INTEREST CHARGE",
  })),
  {
    date: "2028-01-14",
    amountCents: 3_000,
    accountId: "chk",
    pfc: "FOOD_AND_DRINK_GROCERIES",
    description: "CORNER MARKET",
  },
];

describe("a card charging interest, when the data stopped coming in", () => {
  it("still is weeks and months later", () => {
    for (const asOf of ["2028-01-20", "2028-02-24", "2028-02-28", "2028-04-01"]) {
      expect(payingCardInterest({ asOf, transactions }), asOf).toBe(true);
    }
  });
});
