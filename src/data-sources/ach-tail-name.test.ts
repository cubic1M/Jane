import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "./merchant";

// Debug 2, desktop sweep 7, upload S4 (11-19, Chase checking): Spending & bills' next month of bills
// read "Dec 1 · Avalon Bay Rent Ach Web $1,400.00", from "AVALON BAY RENT ACH WEB": the ACH line's
// own code, not the payee, as "MAPLE COURT APTS RENT WEB PMTS" is Maple Court Apts Rent.

const name = (description: string) => normalizeMerchant(description)?.name;

describe("an ACH line's code at the end", () => {
  it("leaves the payee", () => {
    expect(name("AVALON BAY RENT ACH WEB")).toBe("Avalon Bay Rent");
    expect(name("CITY OF PALO ALTO UTIL ACH PPD")).toBe("City Of Palo Alto Util");
    expect(name("STATE FARM INSURANCE ACH")).toBe("State Farm Insurance");
  });

  it("keeps the rest as it was", () => {
    expect(name("NETFLIX.COM NETFLIX.COM CA")).toBe("Netflix");
    expect(name("VERIZON WIRELESS PAYMENTS")).toBe("Verizon Wireless Payments");
  });
});
