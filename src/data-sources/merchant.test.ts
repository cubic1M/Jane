import { describe, expect, it } from "vitest";
import { normalizeMerchant, withoutCity, withoutPaymentApp } from "./merchant";

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
    // CSV bench: Citi pads the merchant to a column before the city; Capital One 360's dash.
    ["SPOTIFY USA              SAN FRANCISCO CA", "Spotify Usa"],
    ["Debit Card Purchase - PAYPAL *HULU CHICAGO IL", "Hulu Chicago"],
    ["Debit Card Purchase - HULU 877-8244858 CHICAGO IL", "Hulu Chicago"],
    ["CHECKCARD 0818 PAYPAL *HULU DENVER CO 81486510203861977402251", "Hulu Denver"],
    ["76 - CHEVRON 0091", "76 Chevron"],
    ["ORIG CO NAME:ACME CORP PAYROLL", "Acme Corp Payroll"],
    ["POS PURCHASE TARGET T-1234", "Target"],
    ["ACME CORP PAYROLL PPD ID: 9876543210", "Acme Corp Payroll"],
    // Bank of America's ACH lines, Capital One 360's and Wells Fargo's card lines.
    ["NETFLIX.COM DES:NETFLIX.COM ID:XXXXX12345 INDN:SAM EXAMPLE CO ID:XXXXX WEB", "Netflix"],
    ["Debit Card Purchase - PLANET FITNESS 800-123-4567 NH", "Planet Fitness"],
    ["PURCHASE AUTHORIZED ON 09/11 SAFEWAY #1234 OAKLAND CA S386254 CARD 1234", "Safeway Oakland"],
  ])("cleans %j to %j", (description, name) => {
    expect(normalizeMerchant(description)?.name).toBe(name);
  });

  it("gives the same key regardless of case, store numbers and dates", () => {
    const a = normalizeMerchant("Netflix.com 10/01");
    const b = normalizeMerchant("NETFLIX.COM NETFLIX.COM CA 11/01");
    expect(a?.key).toBe("netflix");
    expect(b?.key).toBe("netflix");
  });

  it("offers the key without the city, only after a state", () => {
    expect(withoutCity("SPOTIFY P1A2B3C4D5 CHICAGO IL")).toEqual(["spotify"]);
    expect(
      withoutCity("CHECKCARD 0821 SPOTIFY P1A2B3C4D5 CHICAGO IL 17419018686842282428012"),
    ).toEqual(["spotify"]);
    expect(withoutCity("HULU 877-8244858 SAN FRANCISCO CA")).toEqual(["hulu san", "hulu"]);
    expect(withoutCity("APPLE STORE R123")).toEqual([]);
  });

  it("returns null when nothing merchant-like is left", () => {
    expect(normalizeMerchant("#####")).toBeNull();
    expect(normalizeMerchant("123456 CA")).toBeNull();
  });
  // Overnight beta list: the payment app goes, the memo and date after the payee too.
  it.each([
    ["Zelle To Oak Ridge Apts Rent", "Oak Ridge Apts"],
    ["ZELLE PAYMENT TO OAK RIDGE APTS JPM99ABC1234", "Oak Ridge Apts"],
    ['Zelle payment to OAK RIDGE for "Rent"; Conf# abc123', "Oak Ridge"],
    ["ZELLE TO SMITH JOHN ON 10/03 REF # WFCT0ABC", "Smith John"],
    ["VENMO PAYMENT TO JORDAN LEE", "Jordan Lee"],
    ["CASHAPP TO ALEX", "Alex"],
    ["Apple Cash Sent To Kim Payment", "Kim"],
  ])("drops the payment app: %s is %s", (description, name) => {
    expect(normalizeMerchant(description)?.name).toBe(name);
  });

  it("keeps the direction of money in, so its key isn't the one for money out", () => {
    expect(normalizeMerchant("ZELLE FROM MOM")).toEqual({ name: "From Mom", key: "from mom" });
    expect(normalizeMerchant("Zelle money received from Sam Rivera")?.name).toBe("From Sam Rivera");
    expect(normalizeMerchant("ZELLE TO MOM")?.key).toBe("mom");
  });

  it("gives a stored name the same key again, so old and new imports stay one merchant", () => {
    for (const d of ["Zelle To Oak Ridge Apts Rent", "ZELLE FROM MOM"]) {
      const once = normalizeMerchant(d);
      expect(normalizeMerchant(once?.name ?? "")).toEqual(once);
    }
  });

  it("keeps the app when there's no payee after it, or the payee would be empty", () => {
    expect(normalizeMerchant("VENMO PAYMENT 1234567890 WEB ID: 3264681992")?.name).toBe(
      "Venmo Payment",
    );
    expect(normalizeMerchant("Zelle To Rent")?.name).toBe("Rent");
    expect(withoutPaymentApp("ZELLE TRANSFER CONF JANE DOE")).toBe("ZELLE TRANSFER CONF JANE DOE");
  });
});
