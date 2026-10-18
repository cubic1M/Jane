import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "./merchant";

describe("normalizeMerchant", () => {
  it.each([
    ["NETFLIX.COM NETFLIX.COM CA 10/03", "Netflix"],
    ["SQ *BLUE BOTTLE COFFEE #123 OAKLAND CA", "Blue Bottle Coffee Oakland"],
    ["STARBUCKS STORE 06235 NEW YORK NY", "Starbucks New York"],
    ["AMZN Mktp US*2K4L91RT0", "Amzn Mktp Us"],
    ["TST* JOE'S PIZZA 10/02", "Joe's Pizza"],
    ["PAYPAL *HULU 402-935-7733 CA", "Hulu"],
    ["UBER   *TRIP HELP.UBER.COM CA", "Uber"],
    ["APPLE.COM/BILL 866-712-7753 CA", "Apple"],
    ["7-ELEVEN 34567 SAN JOSE CA", "7-Eleven San Jose"],
    ["76 - CHEVRON 0091", "76 Chevron"],
    ["ORIG CO NAME:ACME CORP PAYROLL", "Acme Corp Payroll"],
    ["POS PURCHASE TARGET T-1234", "Target"],
    ["ACME CORP PAYROLL PPD ID: 9876543210", "Acme Corp Payroll"],
  ])("cleans %j to %j", (description, name) => {
    expect(normalizeMerchant(description)?.name).toBe(name);
  });

  it("gives the same key regardless of case, store numbers and dates", () => {
    const a = normalizeMerchant("Netflix.com 10/01");
    const b = normalizeMerchant("NETFLIX.COM NETFLIX.COM CA 11/01");
    expect(a?.key).toBe("netflix");
    expect(b?.key).toBe("netflix");
  });

  it("returns null when nothing merchant-like is left", () => {
    expect(normalizeMerchant("#####")).toBeNull();
    expect(normalizeMerchant("123456 CA")).toBeNull();
  });
});
