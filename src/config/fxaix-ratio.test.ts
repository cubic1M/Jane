import { describe, expect, it } from "vitest";
import { FUND_FACTS } from "./funds";

// Fidelity 500 Index and Fidelity Total Market Index cost 0.015% a year: the risk/return data of
// Fidelity's 485BPOS filed 2026-04-24 gives 0.00015 for each (oef:ExpensesOverAssets, classes
// C000100045 and C000103359). Kept to whole basis points, the table held 1 (0.01%), and the chat
// said "0.01%" where the walkers read 0.015% (walk notes, 11-18).
const FILING =
  "SEC 485BPOS filed 2026-04-24, fee table: https://www.sec.gov/Archives/edgar/data/819118/000081911826000072/";

describe("Fidelity's index funds' yearly cost", () => {
  it.each(["FXAIX", "FSKAX"])("%s is the filing's 1.5 basis points, with its source", (ticker) => {
    const facts = FUND_FACTS[ticker]!;
    expect(facts.expenseRatioBps).toBe(1.5);
    expect(facts.asOf).toBe("2026-04-24");
    expect(facts.source).toBe(FILING);
  });
});
