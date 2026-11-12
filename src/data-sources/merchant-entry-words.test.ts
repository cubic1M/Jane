import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "./merchant";

// Debugger 11-12: a student's Wells Fargo upload named its payees "Maple Court Apts Rent Web
// Pmts", "Dayton Power Light Bill Paymt" and "T-Mobile Pcs Svc", and Jane's cards said them that
// way. The entry's words after the company, however the bank abbreviates them, aren't the name.

const name = (description: string) => normalizeMerchant(description)?.name ?? null;

describe("an ACH line's entry words after the company", () => {
  it("are dropped however the bank abbreviates them", () => {
    expect(name("MAPLE COURT APTS RENT WEB PMTS")).toBe("Maple Court Apts Rent");
    expect(name("DAYTON POWER LIGHT BILL PAYMT")).toBe("Dayton Power Light");
    expect(name("OHIO EDISON BILL PYMT")).toBe("Ohio Edison");
    expect(name("CITY OF AKRON WATER BILL PMT")).toBe("City Of Akron Water");
    expect(name("COMCAST ONLINE PYMT")).toBe("Comcast");
    expect(name("GEICO MOBILE PMTS")).toBe("Geico");
    expect(name("T-MOBILE PCS SVC")).toBe("T-Mobile");
  });

  it("still drops the words it always did, and keeps a name that is only those words", () => {
    expect(name("STATE FARM INSURANCE BILL PAY")).toBe("State Farm Insurance");
    expect(name("VERIZON WIRELESS WEB PMT")).toBe("Verizon Wireless");
    // Chase's line for paying its own card: "Chase" alone would be the bank.
    expect(name("CHASE AUTOPAY")).toBe("Chase Autopay");
    expect(name("WEB PMTS")).toBe("Web Pmts");
  });
});
