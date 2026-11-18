import { describe, expect, it } from "vitest";
import { nice } from "./helpers";

// Debugger 11-18 (r349, 14 months of Wells Fargo checking paying "T-MOBILE AUTO PAY", on a phone):
// the dock's bill card said "You pay T-Mobile Auto Pay $85.00 a month". The merchant names drop the
// bank's word for the entry ("AUTO PAY", "BILL PAY", "WEB PMTS"); the cards' names do too.

describe("a payee named on a card", () => {
  it("leaves out the bank's word for the entry", () => {
    expect(nice("T-MOBILE AUTO PAY")).toBe("T-Mobile");
    expect(nice("STATE FARM INSURANCE BILL PAY")).toBe("State Farm Insurance");
    expect(nice("MAPLE COURT APTS RENT WEB PMTS")).toBe("Maple Court Apts Rent");
  });

  it("keeps Chase's own card payment, where Chase is the payee", () => {
    expect(nice("CHASE AUTOPAY")).toBe("Chase Autopay");
  });
});
