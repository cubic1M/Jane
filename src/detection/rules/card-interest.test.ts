import { describe, expect, it } from "vitest";
import { CARD, CHECKING, input, tx } from "../__fixtures__/build";
import { cardInterest } from "./card-interest";

const interest = (amountCents: number, date: string, accountId = CARD.id) =>
  tx({
    accountId,
    date,
    amountCents,
    description: "PURCHASE INTEREST CHARGE",
    pfcPrimary: "BANK_FEES",
    pfcDetailed: "BANK_FEES_INTEREST_CHARGE",
  });

describe("card_interest", () => {
  it("totals interest on credit accounts over the last 12 months", () => {
    const transactions = [interest(2310, "2026-08-25"), interest(2655, "2026-09-25")];

    const [finding] = cardInterest(input({ transactions }), []);

    expect(finding).toMatchObject({
      type: "card_interest",
      key: "account:acct_card",
      title: "$49.65 in interest on Example Rewards Card in the last 12 months",
      annualSavingsCents: 4965,
      confidence: "high",
    });
  });

  it("ignores interest-like rows on non-credit accounts", () => {
    expect(
      cardInterest(input({ transactions: [interest(500, "2026-09-25", CHECKING.id)] }), []),
    ).toEqual([]);
  });

  it("finds nothing without interest charges", () => {
    expect(cardInterest(input(), [])).toEqual([]);
  });
});
