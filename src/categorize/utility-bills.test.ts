import { describe, expect, it } from "vitest";
import { categorizeByRules } from "./rules";

// Debugger 11-12: a student's uploaded Wells Fargo statement had "DAYTON POWER LIGHT BILL PAYMT"
// three times with no category, so Jane's first cards asked whether their electric bill was "a
// business cost" before it could close the month. Electric companies named "Power & Light",
// "<State> Power" and the big ones with names of their own are bills.

const out = (description: string) =>
  categorizeByRules({ description, amountCents: 5_100, hints: {} })?.detailed ?? null;

const ELECTRIC = "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY";

describe("electric bills on a statement", () => {
  it("knows the Power & Light companies however the bank spells them", () => {
    expect(out("DAYTON POWER LIGHT BILL PAYMT")).toBe(ELECTRIC);
    expect(out("FLORIDA POWER & LIGHT WEB PMT")).toBe(ELECTRIC);
    expect(out("DAYTON POWER AND LIGHT ONLINE PMT")).toBe(ELECTRIC);
    expect(out("FPL DIRECT DEBIT ELEC PYMT")).toBe(ELECTRIC);
    expect(out("OTTER TAIL LIGHT & POWER")).toBe(ELECTRIC);
  });

  it("knows the state Power companies and the ones with names of their own", () => {
    for (const bill of [
      "GEORGIA POWER BILL PAYMENT",
      "ALABAMA POWER CO WEB",
      "IDAHO POWER COMPANY",
      "APPALACHIAN POWER PAYMENT",
      "ENTERGY ARKANSAS PAYMENT",
      "AMEREN MISSOURI AUTOPAY",
      "EVERSOURCE ENERGY",
      "PEPCO BILL PAY",
      "PSE&G ONLINE PAYMENT",
      "AES OHIO PAYMENT",
      "XCEL WEB PAYMENT",
    ])
      expect(out(bill), bill).toBe(ELECTRIC);
  });

  it("doesn't take a gym, a drink or a lottery for a power bill", () => {
    expect(out("POWERADE 12PK")).not.toBe(ELECTRIC);
    expect(out("POWER YOGA STUDIO")).not.toBe(ELECTRIC);
    expect(out("POWERBALL TICKET")).not.toBe(ELECTRIC);
    expect(out("LIGHT RAIL FARE")).not.toBe(ELECTRIC);
  });
});
