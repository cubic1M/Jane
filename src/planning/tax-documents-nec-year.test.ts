import { describe, expect, it } from "vitest";
import { necThreshold } from "@/config/tax";
import { expectedForms } from "./tax-documents";

// CodeRabbit sweep 1c, cfg-04 #3: a year the table doesn't cover has no 1099-NEC threshold; it
// never borrows 2026's $2,000 to say a payer "may not send" a form.

const nec = (year: number, cents: number) =>
  expectedForms({
    year,
    transactions: [
      {
        date: `${year}-06-01`,
        pfcDetailed: "INCOME_CONTRACTOR",
        description: "Client payment",
        merchantName: "Uber",
        amountCents: -cents,
        accountName: "Checking",
      },
    ],
    accounts: [],
    loans: [],
  }).find((f) => f.formKey === "nec");

describe("the 1099-NEC threshold by year", () => {
  it("knows only the years in the table", () => {
    expect(necThreshold(2026)).toBe(200_000);
    expect(necThreshold(2025)).toBe(60_000);
    expect(necThreshold(2024)).toBeNull();
    expect(necThreshold(2027)).toBeNull();
  });

  it("says may-not-send for a covered year, and nothing for one that isn't", () => {
    expect(nec(2026, 150_000)?.mayNotSend).toBe(true);
    expect(nec(2025, 50_000)?.mayNotSend).toBe(true);
    // $1,500 in 2024 was over that year's threshold: 2026's $2,000 must not call it small.
    expect(nec(2024, 150_000)?.mayNotSend).toBe(false);
    expect(nec(2027, 150_000)?.mayNotSend).toBe(false);
  });
});
