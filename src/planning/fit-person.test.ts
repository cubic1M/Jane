import { describe, expect, it } from "vitest";
import type { ProfileInput } from "@/profile/build";
import { fitPersonFrom } from "./fit-person";

// The debt payments a lender counts: three months of loan payments, a month each. On the 1st, a
// window of 93 days took in four payments made on the 1st, so the demo car loan's refinance was
// turned down for debt over the limit that day (debugger 11-01).

const input = (today: string, dates: string[]): ProfileInput => ({
  today,
  transactions: dates.map((date, i) => ({
    accountId: "a",
    date,
    amountCents: 50_000,
    description: `CAR LOAN PAYMENT ${i}`,
    pfc: "LOAN_PAYMENTS_CAR_PAYMENT",
  })),
  accounts: [],
  liabilities: [],
  told: {},
});

describe("fitPersonFrom", () => {
  it("counts one month's loan payments, whatever the day", () => {
    const dates = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"];
    for (const today of ["2026-10-31", "2026-11-01", "2026-11-15"]) {
      const seen = dates.filter((d) => d <= today);
      expect(fitPersonFrom(input(today, seen)).debtPaymentsCents).toBe(50_000);
    }
  });
});
