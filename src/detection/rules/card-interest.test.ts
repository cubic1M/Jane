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
    // A card with a year of history.
    const transactions = [
      tx({ accountId: CARD.id, date: "2025-11-02", amountCents: 1200, description: "TARGET" }),
      interest(2310, "2026-08-25"),
      interest(2655, "2026-09-25"),
    ];

    const [finding] = cardInterest(input({ transactions }), []);

    expect(finding).toMatchObject({
      type: "card_interest",
      key: "account:acct_card",
      title: "$49.65 in interest on Example Rewards Card in the last 12 months",
      annualSavingsCents: 4965,
      confidence: "high",
    });
  });

  // Overnight upload QA: 3 months of statements said "$66.77 … in the last 12 months" and
  // "save about $66.77 a year".
  it("says the months a short history covers, and counts interest at its yearly pace", () => {
    const transactions = [
      tx({ accountId: CARD.id, date: "2026-07-17", amountCents: 1200, description: "TARGET" }),
      interest(2310, "2026-08-25"),
      interest(2655, "2026-09-25"),
    ];

    const [finding] = cardInterest(input({ transactions }), []);

    expect(finding.title).toBe("$49.65 in interest on Example Rewards Card in the last 3 months");
    expect(finding.amountCents).toBe(4965);
    // 90 days of history: $49.65 × 365.25 / 90.
    expect(finding.annualSavingsCents).toBe(20150);
  });

  it("doesn't count a single month's interest at a yearly pace", () => {
    const transactions = [
      tx({ accountId: CARD.id, date: "2026-07-17", amountCents: 1200, description: "TARGET" }),
      interest(2310, "2026-09-25"),
    ];

    const [finding] = cardInterest(input({ transactions }), []);

    expect(finding.title).toBe("$23.10 in interest on Example Rewards Card in the last 3 months");
    expect(finding.annualSavingsCents).toBe(2310);
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
