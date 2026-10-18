import { describe, expect, it } from "vitest";
import {
  ASSUMED_CURRENT_RATE_BPS,
  IDLE_CASH_MONTHS_OF_SPENDING,
  REFERENCE_HIGH_YIELD_RATE_BPS,
} from "@/config/detection";
import { CARD, CHECKING, GROCERIES, SAVINGS, input, monthly, tx } from "../__fixtures__/build";
import { BASIS_POINTS } from "../units";
import { idleCash } from "./idle-cash";

// $2,000 a month of spending on the card for seven months: a steady, known history.
const spending = monthly(7, 200_000, { ...GROCERIES, accountId: CARD.id });

describe("idle_cash", () => {
  it("finds cash above three months of spending", () => {
    // Balances: $2,500 checking + $15,000 savings = $17,500. Spending ~$2,000/month over
    // ~6 months of history, so the cushion is ~$6,000 and roughly $11,500 is idle.
    const [finding] = idleCash(input({ transactions: spending }), []);

    const { averageMonthlySpendingCents, excessCents } = finding.evidence as Record<string, number>;
    expect(finding).toMatchObject({ type: "idle_cash", key: "depository", confidence: "high" });
    expect(excessCents).toBe(
      1_750_000 - averageMonthlySpendingCents * IDLE_CASH_MONTHS_OF_SPENDING,
    );
    expect(finding.amountCents).toBe(excessCents);
    expect(finding.annualSavingsCents).toBe(
      Math.round(
        (excessCents * (REFERENCE_HIGH_YIELD_RATE_BPS - ASSUMED_CURRENT_RATE_BPS)) / BASIS_POINTS,
      ),
    );
  });

  it("leaves transfers and card payments out of spending", () => {
    const transactions = [
      ...spending,
      ...monthly(7, 500_000, {
        description: "ONLINE TRANSFER TO SAV",
        pfcPrimary: "TRANSFER_OUT",
        pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      ...monthly(7, 200_000, {
        description: "PAYMENT TO EXAMPLE CARD",
        pfcPrimary: "LOAN_PAYMENTS",
        pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      }),
    ];

    expect(idleCash(input({ transactions }), [])[0].evidence.averageMonthlySpendingCents).toBe(
      idleCash(input({ transactions: spending }), [])[0].evidence.averageMonthlySpendingCents,
    );
  });

  it("is low confidence with under three months of history", () => {
    const transactions = [tx({ ...GROCERIES, date: "2026-09-20", amountCents: 150_000 })];

    expect(idleCash(input({ transactions }), [])[0].confidence).toBe("low");
  });

  it("finds nothing when balances are within the cushion", () => {
    const accounts = [
      { ...CHECKING, currentBalanceCents: 300_000 },
      { ...SAVINGS, currentBalanceCents: 200_000 },
    ];

    expect(idleCash(input({ accounts, transactions: spending }), [])).toEqual([]);
  });

  it("finds nothing without balances or without spending history", () => {
    const accounts = [{ ...CHECKING, currentBalanceCents: null }, CARD];

    expect(idleCash(input({ accounts, transactions: spending }), [])).toEqual([]);
    expect(idleCash(input(), [])).toEqual([]);
  });
});
