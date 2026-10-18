import { describe, expect, it } from "vitest";
import { CARD, CHECKING, GROCERIES, input, tx } from "../__fixtures__/build";
import { bankFees } from "./bank-fees";

const fee = (detailed: string, amountCents: number, date: string, accountId = CHECKING.id) =>
  tx({
    accountId,
    date,
    amountCents,
    description: detailed,
    pfcPrimary: "BANK_FEES",
    pfcDetailed: detailed,
  });

describe("bank_fees", () => {
  it("totals fees per account over the last 12 months", () => {
    const transactions = [
      fee("BANK_FEES_OVERDRAFT_FEES", 3400, "2026-03-02"),
      fee("BANK_FEES_ATM_FEES", 300, "2026-06-11"),
      fee("BANK_FEES_OTHER_BANK_FEES", 1200, "2026-09-30"),
      fee("BANK_FEES_LATE_FEES", 4000, "2026-08-20", CARD.id),
    ];

    const findings = bankFees(input({ transactions }), []);

    expect(findings.map((f) => [f.key, f.annualSavingsCents, f.confidence])).toEqual([
      ["account:acct_card", 4000, "high"],
      ["account:acct_checking", 4900, "high"],
    ]);
    expect(findings[1].title).toBe("$49.00 in fees on Everyday Checking in the last 12 months");
    expect((findings[1].evidence.transactions as unknown[]).length).toBe(3);
  });

  it("leaves interest to the card interest finding", () => {
    const transactions = [fee("BANK_FEES_INTEREST_CHARGE", 2500, "2026-09-01", CARD.id)];

    expect(bankFees(input({ transactions }), [])).toEqual([]);
  });

  it("nets refunded fees and finds nothing if all were refunded", () => {
    const transactions = [
      fee("BANK_FEES_OVERDRAFT_FEES", 3400, "2026-09-02"),
      fee("BANK_FEES_OVERDRAFT_FEES", -3400, "2026-09-05"),
    ];

    expect(bankFees(input({ transactions }), [])).toEqual([]);
  });

  it("ignores fees older than 12 months", () => {
    const transactions = [fee("BANK_FEES_OVERDRAFT_FEES", 3400, "2025-10-15")];

    expect(bankFees(input({ transactions }), [])).toEqual([]);
  });

  it("rates fees the LLM categorized as medium confidence", () => {
    const transactions = [
      { ...fee("BANK_FEES_OTHER_BANK_FEES", 1500, "2026-09-02"), categorySource: "llm" as const },
    ];

    expect(bankFees(input({ transactions }), [])[0].confidence).toBe("medium");
  });

  it("finds nothing without fees", () => {
    expect(bankFees(input({ transactions: [tx(GROCERIES)] }), [])).toEqual([]);
  });
});
