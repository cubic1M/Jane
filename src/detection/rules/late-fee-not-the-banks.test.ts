import { describe, expect, it } from "vitest";
import { CARD, CHECKING, input, tx } from "../__fixtures__/build";
import { bankFees } from "./bank-fees";
import { bankFeesYear } from "@/planning/bank-fees";

// Debugger 11-16 (a Chase checking upload on a phone): "NELNET STUDENT LOAN LATE FEE" ($14, paid
// from checking) read "$14.00 in fees on Chase checking in the last 4 months", beside the dock's
// "Pay at least the minimum automatically, save $14 a year" for the same fee. A checking account
// charges no late fee of its own: one paid from it is a loan's or a bill's, the late-fee
// suggestion's to say. A card's own late fee is still a fee on the card.

const fee = (
  description: string,
  detailed: string,
  cents: number,
  date: string,
  accountId = CHECKING.id,
) =>
  tx({
    accountId,
    date,
    amountCents: cents,
    description,
    pfcPrimary: "BANK_FEES",
    pfcDetailed: detailed,
  });

describe("a late fee paid from checking", () => {
  it("isn't a fee on the checking account", () => {
    const transactions = [
      fee("NELNET STUDENT LOAN LATE FEE", "BANK_FEES_LATE_FEES", 1_400, "2026-09-04"),
    ];
    expect(bankFees(input({ transactions }), [])).toEqual([]);
  });

  it("leaves the checking account's own fees, and a card's late fee, counted", () => {
    const transactions = [
      fee("NELNET STUDENT LOAN LATE FEE", "BANK_FEES_LATE_FEES", 1_400, "2026-09-04"),
      fee("MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES", 1_200, "2026-09-30"),
      fee("LATE FEE", "BANK_FEES_LATE_FEES", 4_000, "2026-08-20", CARD.id),
    ];
    const found = bankFees(input({ transactions }), []);
    expect(found.map((f) => [f.key, f.annualSavingsCents])).toEqual([
      ["account:acct_card", 4_000],
      ["account:acct_checking", 1_200],
    ]);
    const checking = found.find((f) => f.key === "account:acct_checking")!;
    expect((checking.evidence.transactions as unknown[]).length).toBe(1);
  });

  it("isn't in the dock's and the chat's year of bank fees either", () => {
    const late = {
      date: "2026-09-04",
      amountCents: 1_400,
      description: "NELNET STUDENT LOAN LATE FEE",
      pfc: "BANK_FEES_LATE_FEES",
      accountId: CHECKING.id,
      onCash: true,
    };
    expect(bankFeesYear([late], 4)).toBeNull();
    expect(bankFeesYear([{ ...late, onCash: false }], 4)?.seenCents).toBe(1_400);
  });
});
