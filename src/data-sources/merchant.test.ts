import { describe, expect, it } from "vitest";
import { normalizeMerchant, withoutCity, withoutPaymentApp, withoutAchDetails } from "./merchant";

describe("normalizeMerchant", () => {
  it.each([
    ["NETFLIX.COM NETFLIX.COM CA 10/03", "Netflix"],
    ["SQ *BLUE BOTTLE COFFEE #123 OAKLAND CA", "Blue Bottle Coffee"],
    ["STARBUCKS STORE 06235 NEW YORK NY", "Starbucks"],
    ["AMZN Mktp US*2K4L91RT0", "Amzn Mktp Us"],
    ["TST* JOE'S PIZZA 10/02", "Joe's Pizza"],
    ["PAYPAL *HULU 402-935-7733 CA", "Hulu"],
    ["UBER   *TRIP HELP.UBER.COM CA", "Uber"],
    ["APPLE.COM/BILL 866-712-7753 CA", "Apple"],
    ["7-ELEVEN 34567 SAN JOSE CA", "7-Eleven"],
    // CSV bench: Citi pads the merchant to a column before the city; Capital One 360's dash.
    ["SPOTIFY USA              SAN FRANCISCO CA", "Spotify Usa"],
    ["Debit Card Purchase - PAYPAL *HULU CHICAGO IL", "Hulu"],
    ["Debit Card Purchase - HULU 877-8244858 CHICAGO IL", "Hulu"],
    ["CHECKCARD 0818 PAYPAL *HULU DENVER CO 81486510203861977402251", "Hulu"],
    ["76 - CHEVRON 0091", "76 Chevron"],
    ["ORIG CO NAME:ACME CORP PAYROLL", "Acme Corp Payroll"],
    ["POS PURCHASE TARGET T-1234", "Target"],
    ["ACME CORP PAYROLL PPD ID: 9876543210", "Acme Corp Payroll"],
    // Bank of America's ACH lines, Capital One 360's and Wells Fargo's card lines.
    ["NETFLIX.COM DES:NETFLIX.COM ID:XXXXX12345 INDN:SAM EXAMPLE CO ID:XXXXX WEB", "Netflix"],
    ["Debit Card Purchase - PLANET FITNESS 800-123-4567 NH", "Planet Fitness"],
    ["PURCHASE AUTHORIZED ON 09/11 SAFEWAY #1234 OAKLAND CA S386254 CARD 1234", "Safeway"],
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
    expect(withoutCity("SPOTIFY P1A2B3C4D5 EVANSTON IL")).toEqual(["spotify"]);
    expect(
      withoutCity("CHECKCARD 0821 SPOTIFY P1A2B3C4D5 EVANSTON IL 17419018686842282428012"),
    ).toEqual(["spotify"]);
    expect(withoutCity("HULU 877-8244858 SANTA CLARA CA")).toEqual(["hulu santa", "hulu"]);
    // A well-known city is already out of the key (CARD_CITIES).
    expect(withoutCity("SPOTIFY P1A2B3C4D5 CHICAGO IL")).toEqual([]);
    expect(normalizeMerchant("SPOTIFY P1A2B3C4D5 CHICAGO IL")?.key).toBe("spotify");
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

describe("withoutAchDetails", () => {
  it("keeps the company of a Bank of America ACH line", () => {
    expect(withoutAchDetails("VERIZON WIRELESS DES:PAYMENTREC ID:XXXXX")).toBe("VERIZON WIRELESS");
    expect(
      withoutAchDetails("GLOBEX LLC DES:PAYROLL ID:XXXXX9028 INDN:EXAMPLE,SAM CO ID:XXXXX PPD"),
    ).toBe("GLOBEX LLC");
  });

  it("leaves every other line as it is", () => {
    expect(withoutAchDetails("COMCAST XFINITY 800-266-2278")).toBe("COMCAST XFINITY 800-266-2278");
    expect(withoutAchDetails("DES:ONLY")).toBe("DES:ONLY");
  });
});

// Debugger 10-30: Navy Federal writes "PAID TO - USAA P&C INS" and "DEPOSIT - DFAS-CLEVELAND MIL
// PAY": the insurance card read "You pay Paid To Usaa P&C Ins $1,656.00 a year".
describe("Navy Federal's prefixes", () => {
  it("leaves out PAID TO - and DEPOSIT - before the name", () => {
    expect(normalizeMerchant("PAID TO - USAA P&C INS")?.key).toBe("usaa p&c ins");
    expect(normalizeMerchant("PAID TO - OAKWOOD APTS RENT")?.name).toMatch(/^Oakwood/);
    expect(normalizeMerchant("DEPOSIT - DFAS-CLEVELAND MIL PAY")?.key).toBe(
      "dfas-cleveland mil pay",
    );
  });
});

// Debugger 10-31: Capital One 360 writes "Withdrawal to ROCKET MORTGAGE PMT" and "Deposit from
// STARK INDUSTRIES PAYROLL" (the CSV bench has the same): /subscriptions listed "Withdrawal To
// Rocket Mortgage Pmt $2,280.00 monthly".
describe("Capital One 360's prefixes", () => {
  it("leaves out Withdrawal to and Deposit from before the name", () => {
    expect(normalizeMerchant("Withdrawal to ROCKET MORTGAGE PMT")?.name).toMatch(
      /^Rocket Mortgage/,
    );
    expect(normalizeMerchant("Withdrawal to VENMO PAYMENT")?.name).toMatch(/^Venmo/);
    expect(normalizeMerchant("Deposit from STARK INDUSTRIES PAYROLL")?.name).toMatch(/^Stark/);
  });
});

// Debugger 11-01: a service member's /subscriptions listed "Usaa P&C Ins Autopay" and "Nfcu Auto
// Loan Pmt"; the IRS's "IRS USATAXPYMT" read "Irs". Known acronyms and "AT&T" stay in capitals;
// the key is unchanged.
describe("acronyms in names", () => {
  it("keeps well-known acronyms and AT&T in capitals", () => {
    expect(normalizeMerchant("USAA P&C INS AUTOPAY")?.name).toBe("USAA P&C Ins Autopay");
    expect(normalizeMerchant("NFCU AUTO LOAN PMT")?.name).toBe("NFCU Auto Loan Pmt");
    expect(normalizeMerchant("CVS/PHARMACY #4321")?.name).toBe("CVS Pharmacy");
    expect(normalizeMerchant("AT&T BILL PAYMENT")?.name).toBe("AT&T Bill Payment");
    // Debugger 11-01: "ATT*BILL PAYMENT 800-331-0500 TX" read "Att" on /subscriptions.
    expect(normalizeMerchant("ATT*BILL PAYMENT 800-331-0500 TX")).toEqual({
      name: "ATT",
      key: "att",
    });
    expect(normalizeMerchant("USAA P&C INS AUTOPAY")?.key).toBe("usaa p&c ins autopay");
  });

  it("leaves ordinary words as they were", () => {
    expect(normalizeMerchant("PLANET FITNESS CLUB FEES")?.name).toBe("Planet Fitness Club Fees");
    expect(normalizeMerchant("IRSA HOLDINGS")?.name).toBe("Irsa Holdings");
  });
});

// Debugger 11-01: the tax pack a person hands their preparer listed "IRS Usataxpymt" three
// times, and the chat said "IRS Usataxpymt is $150.00 a month". USATAXPYMT is the IRS's ACH entry
// description ("USA tax payment"), not part of the payee: it goes from the name and the key, so
// every bank's line gives the key Bank of America's "IRS DES:USATAXPYMT" already gives. The
// migration 20270420000000_merchant_irs_tax_payment moves saved keys and names.
describe("the IRS's tax payment line", () => {
  it("is the IRS, on every bank's line", () => {
    for (const line of [
      "IRS USATAXPYMT",
      "Withdrawal to IRS USATAXPYMT",
      "IRS  USATAXPYMT 270611111111111",
      "IRS DES:USATAXPYMT ID:XXXXX INDN:SAM DOE CO ID:3387702000 PPD",
      // A name saved the old way gives the new key too.
      "IRS Usataxpymt",
    ]) {
      expect(normalizeMerchant(line), line).toEqual({ name: "IRS", key: "irs" });
    }
  });

  it("keeps the word when it is all there is", () => {
    expect(normalizeMerchant("USATAXPYMT")).toEqual({ name: "Usataxpymt", key: "usataxpymt" });
  });
});

// Debugger 11-01: "Review your Doordash Dashpass San Francisco subscription" and "Peloton App
// Membership New York": the city a card writes before its state stayed in the name and the key.
// A well-known city goes from both, with or without the state after it, so a name saved before
// ("Doordash Dashpass San Francisco") gives the same key as the bank's line. The migration
// 20270419000000_merchant_without_card_city moves saved keys.
describe("a city at the end", () => {
  it("leaves a well-known city out of the name and the key", () => {
    expect(normalizeMerchant("DOORDASH DASHPASS SAN FRANCISCO CA")).toEqual({
      name: "Doordash Dashpass",
      key: "doordash dashpass",
    });
    expect(normalizeMerchant("PELOTON APP MEMBERSHIP NEW YORK NY")?.name).toBe(
      "Peloton App Membership",
    );
    expect(normalizeMerchant("NETFLIX.COM LOS GATOS CA")?.key).toBe("netflix");
    // A name saved before this, read again.
    expect(normalizeMerchant("Doordash Dashpass San Francisco")?.key).toBe("doordash dashpass");
  });

  it("keeps a city that is the name, or part of it", () => {
    expect(normalizeMerchant("SEATTLE CA")?.name).toBe("Seattle");
    expect(normalizeMerchant("NEW YORK TIMES DIGITAL")?.name).toBe("New York Times Digital");
    expect(normalizeMerchant("UNIVERSITY OF CHICAGO")?.name).toBe("University Of Chicago");
    expect(normalizeMerchant("CITY OF SAN JOSE")?.name).toBe("City Of San Jose");
    expect(normalizeMerchant("ZELLE FROM CHICAGO")?.key).toBe("from chicago");
  });
});
