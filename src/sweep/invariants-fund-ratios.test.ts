import { describe, expect, it } from "vitest";
import { FUND_FACTS } from "@/config/funds";
import { formatExpenseRatio } from "@/lib/percent";
import { fundRatios } from "./invariants";

// Class 4 for a fund's yearly cost (debug 3, 11-20): Fidelity 500 Index costs 0.015% a year (its
// 485BPOS filed 2026-04-24, src/config/funds.ts), and every place that shows it says so. The chat
// said "0.01%".

const flat = (body: string) => ({
  "funds.0.ticker": "FXAIX",
  "funds.0.name": "Fidelity 500 Index Fund",
  "funds.0.ratio": formatExpenseRatio(FUND_FACTS.FXAIX!.expenseRatioBps),
  "chat.what fees am I paying on my investments.body": body,
});

describe("a fund's yearly cost", () => {
  it("is the filing's 0.015% for Fidelity 500 Index", () => {
    expect(FUND_FACTS.FXAIX!.expenseRatioBps).toBe(1.5);
    expect(formatExpenseRatio(FUND_FACTS.FXAIX!.expenseRatioBps)).toBe("0.015%");
    expect(FUND_FACTS.FXAIX!.source).toContain(
      "https://www.sec.gov/Archives/edgar/data/819118/000081911826000072/",
    );
  });

  it("fails a ratio beside the fund that isn't the table's", () => {
    expect(
      fundRatios(
        flat(
          "Your investments cost at least $0.51 a year in fund costs.\nThat's Fidelity 500 Index Fund, at 0.01% a year.",
        ),
      ),
    ).toEqual([
      `chat.what fees am I paying on my investments.body: "Fidelity 500 Index Fund, at 0.01%", FXAIX costs 0.015% a year`,
    ]);
    expect(fundRatios(flat("- FXAIX: 0.02%, $1.02 a year"))).toHaveLength(1);
  });

  it("passes the table's ratio, and a percent of something else", () => {
    expect(fundRatios(flat("That's Fidelity 500 Index Fund, at 0.015% a year."))).toEqual([]);
    expect(fundRatios(flat("61% of it is in FXAIX. Bonds are 0%."))).toEqual([]);
  });
});
