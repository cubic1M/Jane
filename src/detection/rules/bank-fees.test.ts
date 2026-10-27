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
      // A year of history on the card.
      tx({ accountId: CARD.id, date: "2025-11-02", amountCents: 2_000, description: "TARGET" }),
    ];

    const findings = bankFees(input({ transactions }), []);

    expect(findings.map((f) => [f.key, f.annualSavingsCents, f.confidence])).toEqual([
      ["account:acct_card", 4000, "high"],
      ["account:acct_checking", 4900, "high"],
    ]);
    expect(findings[1].title).toBe("$49.00 in fees on Everyday Checking in the last 12 months");
    expect((findings[1].evidence.transactions as unknown[]).length).toBe(3);
  });

  it("says the months a short history covers (3 months of uploaded statements)", () => {
    const transactions = [
      fee("BANK_FEES_OTHER_BANK_FEES", 1200, "2026-07-17"),
      fee("BANK_FEES_OTHER_BANK_FEES", 1200, "2026-08-17"),
      fee("BANK_FEES_OTHER_BANK_FEES", 1200, "2026-09-17"),
    ];

    const [finding] = bankFees(input({ transactions }), []);

    expect(finding.title).toBe("$36.00 in fees on Everyday Checking in the last 3 months");
    // A year at that pace, as the dock's and the chat's figure (src/planning/bank-fees.ts).
    expect(finding.annualSavingsCents).toBe(14400);
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

// Spec step 263 (QA sweep): Jo's payment processor fees are a business cost, not a bank fee.
describe("bank_fees and a payment processor", () => {
  const processor = (description: string, date: string) =>
    tx({
      accountId: CHECKING.id,
      date,
      amountCents: 22_000,
      description,
      pfcPrimary: "BANK_FEES",
      pfcDetailed: "BANK_FEES_OTHER_BANK_FEES",
    });

  it("never counts Square, Stripe or other processing fees as bank fees", () => {
    const transactions = [
      "SQUARE PROCESSING FEES",
      "STRIPE FEE",
      "PAYPAL PROCESSING FEES",
      "MERCHANT SERVICES",
    ].map((d, i) => processor(d, `2026-0${i + 3}-05`));
    expect(bankFees(input({ transactions }), [])).toEqual([]);
  });

  it("still finds a real bank fee beside them", () => {
    const transactions = [
      processor("SQUARE PROCESSING FEES", "2026-03-05"),
      fee("BANK_FEES_OVERDRAFT_FEES", 3_400, "2026-04-02"),
    ];
    const findings = bankFees(input({ transactions }), []);
    expect(findings.map((f) => f.annualSavingsCents)).toEqual([3_400]);
  });
});
