import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bankFeesYear, type FeeTx } from "@/planning/bank-fees";
import { FeeList } from "./fee-list";

// The manager, 11-22 (reading #2222): with 12 months overall and one account paced, the card's
// headline (a year of fees) wasn't what the list added up to, and nothing on the page said so.

const fee = (date: string, amountCents: number, accountId: string): FeeTx => ({
  date,
  amountCents,
  description: "LATE FEE",
  pfc: "BANK_FEES_LATE_FEES",
  accountId,
});
const page = (months: (id: string | undefined) => number) => {
  const fees = bankFeesYear(
    [
      fee("2026-03-31", 1_000, "chk"),
      fee("2026-09-30", 2_900, "card"),
      fee("2026-10-31", 2_900, "card"),
    ],
    months,
  )!;
  return { fees, html: renderToStaticMarkup(<FeeList fees={fees} accounts={new Map()} />) };
};

describe("the fee list", () => {
  it("says the year beside what was paid when an account is paced", () => {
    const { fees, html } = page((id) => (id === "card" ? 2 : 12));
    expect(fees.estimated).toBe(false);
    expect(fees.yearCents).toBe(1_000 + 2_900 * 2 * 6);
    expect(html).toContain(
      "$68.00 in 3 fees in the last 12 months, about $358.00 over a year at this pace.",
    );
  });

  it("says only what was paid when that is the year", () => {
    const { html } = page(() => 12);
    expect(html).toContain("$68.00 in 3 fees in the last 12 months.");
    expect(html).not.toContain("over a year");
  });
});
