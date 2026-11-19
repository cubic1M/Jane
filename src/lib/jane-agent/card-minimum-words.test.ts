import { describe, expect, it } from "vitest";
import { debtBook, type DebtAccountInput } from "@/insights/debts";
import { debtDetailReply, debtsReply } from "./debt-replies";

// Debug 2, desktop sweep 7 (11-19, Plaid sandbox, 14 months: a Plaid credit card owing $1,850.40
// at 24.99%, $45.00 minimum, paid $200 a month from checking): "what is my credit card balance?"
// answered "You pay $45.00 a month." The $45.00 is the bank's minimum, not what's paid.

const AS_OF = "2026-11-19";
const card: DebtAccountInput = {
  id: "card",
  name: "Plaid credit card",
  mask: "0082",
  type: "credit",
  subtype: "credit card",
  currentBalanceCents: 185_040,
  liability: {
    aprBps: 2_499,
    minimumPaymentCents: 4_500,
  } as DebtAccountInput["liability"],
};
const book = debtBook({ accounts: [card], plans: [], typed: [] }, AS_OF);

describe("a card's payment on file", () => {
  it("is said as its minimum when asked about the card", () => {
    const body = debtDetailReply("credit card", book).body;
    expect(body).toContain("The minimum is $45.00 a month.");
    expect(body).not.toContain("You pay $45.00");
  });

  it("is said as its minimum in the list of debts", () => {
    expect(debtsReply(book).body).toContain("minimum $45.00 a month");
  });
});
