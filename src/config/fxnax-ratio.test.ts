import { describe, expect, it } from "vitest";
import { formatExpenseRatio } from "@/lib/percent";
import { FUND_FACTS } from "./funds";

// Fidelity U.S. Bond Index costs 0.025% a year: the risk/return data of Fidelity's 485BPOS filed
// 2026-10-27, its latest, gives 0.025 (percent) for the class (oef:ExpensesOverAssets, C000100043).
// Kept to whole basis points, the table held 3 (0.03%), as it once held FXAIX at 1 (#2169). Its
// neighbours in the table were checked the same way on 11-20: FTIHX's 0.06% and FCNTX's 0.74% are
// their latest filings' figures.

describe("Fidelity U.S. Bond Index's yearly cost", () => {
  it("is the latest filing's 2.5 basis points, with its source, shown as 0.025%", () => {
    const facts = FUND_FACTS.FXNAX!;
    expect(facts.expenseRatioBps).toBe(2.5);
    expect(facts.asOf).toBe("2026-10-27");
    expect(facts.source).toBe(
      "SEC 485BPOS filed 2026-10-27, fee table: https://www.sec.gov/Archives/edgar/data/35315/000003531526000765/",
    );
    expect(formatExpenseRatio(facts.expenseRatioBps)).toBe("0.025%");
  });

  it.each([
    ["FTIHX", 6, "2025-12-29"],
    ["FCNTX", 74, "2026-02-24"],
  ] as const)("%s is its latest filing's %d basis points", (ticker, bps, asOf) => {
    expect(FUND_FACTS[ticker]!.expenseRatioBps).toBe(bps);
    expect(FUND_FACTS[ticker]!.asOf).toBe(asOf);
  });
});
