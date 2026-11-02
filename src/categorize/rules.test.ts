import { describe, expect, it } from "vitest";
import { categorizeByRules, payoutByRules } from "./rules";
import { ALL_DETAILED, categoryOf } from "./taxonomy";

const out = (description: string, hints = {}) =>
  categorizeByRules({ description, amountCents: 1000, hints })?.detailed ?? null;
const into = (description: string, hints = {}) =>
  categorizeByRules({ description, amountCents: -1000, hints })?.detailed ?? null;

describe("categorizeByRules", () => {
  // The wordings in the bank CSVs Jane reads (src/data-sources/csv/__fixtures__): a card payment
  // is never spending, from either side, and the card's interest line is interest.
  it.each([
    ["PAYMENT - THANK YOU"],
    ["ONLINE PAYMENT, THANK YOU"],
    ["INTERNET PAYMENT - THANK YOU"],
    ["AUTOPAY PAYMENT - THANK YOU"],
    ["CAPITAL ONE AUTOPAY PYMT"],
    ["Withdrawal to Capital One card ending 1234"],
    ["BANK OF AMERICA CREDIT CARD Bill Payment"],
    // Debugger 11-01: Insights counted "Barclaycard Us Payment" $1,200 as spending, beside the
    // card's own purchases.
    ["BARCLAYCARD US PAYMENT"],
  ])("calls %s a card payment", (description) => {
    expect(out(description)).toBe("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
    expect(into(description)).toBe("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  });

  // CSV bench (docs/accuracy.md): the card's own side of a payment as each company words it.
  it.each([
    ["CAPITAL ONE MOBILE PYMT"],
    ["BA ELECTRONIC PAYMENT"],
    ["AUTOPAY 000000000012345RAUTOPAY AUTO-PMT"],
    ["DIRECTPAY FULL BALANCE"],
    ["AUTOMATIC PAYMENT - THANK"],
    ["MOBILE PAYMENT - THANK YOU"],
  ])("calls money in as %s a card payment", (description) => {
    expect(into(description)).toBe("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  });

  it("leaves a bill paid online going out as a bill", () => {
    expect(out("COMCAST ONLINE PAYMENT")).not.toBe("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  });

  it.each([
    ["Online Banking transfer to SAV 1234 Confirmation# 1234567890", "out"],
    ["Withdrawal to 360 Performance Savings XXXXXX1234", "out"],
    ["Online Banking transfer from CHK 1234 Confirmation# 1234567890", "in"],
    ["Deposit from 360 Checking XXXXXX1234", "in"],
  ])("calls %s a move between the person's accounts", (description, way) => {
    expect(way === "out" ? out(description) : into(description)).toMatch(/^TRANSFER_(OUT|IN)_/);
  });

  it("reads fees as the banks word them, and a fee given back nets against it", () => {
    expect(out("NON-WF ATM WITHDRAWAL FEE 06/20")).toBe("BANK_FEES_ATM_FEES");
    expect(out("ATM WITHDRAWAL AUTHORIZED ON 06/20 123 MAIN ST")).toBe("TRANSFER_OUT_WITHDRAWAL");
    expect(into("FEE REVERSAL")).toMatch(/^BANK_FEES_/);
  });

  it("calls a fare with its 13-digit ticket number a flight, whichever airline", () => {
    expect(out("UNITED 0162345678901")).toBe("TRAVEL_FLIGHTS");
    expect(out("SOUTHWES 5262123456789")).toBe("TRAVEL_FLIGHTS");
    // Longer reference numbers aren't tickets.
    expect(out("CHECKCARD 1002 TARGET 24492156275000012345678")).not.toBe("TRAVEL_FLIGHTS");
  });

  it("reads Capital One's, Discover's and American Express's card categories", () => {
    expect(out("SQ *CORNER STUDIO", { bankCategory: "Dining" })).toBe("FOOD_AND_DRINK_RESTAURANT");
    expect(out("SQ *CORNER STUDIO", { bankCategory: "Restaurants" })).toBe(
      "FOOD_AND_DRINK_RESTAURANT",
    );
    expect(out("SQ *CORNER STUDIO", { bankCategory: "Restaurant-Bar & Café" })).toBe(
      "FOOD_AND_DRINK_RESTAURANT",
    );
    expect(out("CORNER MARKET", { bankCategory: "Supermarkets" })).toBe("FOOD_AND_DRINK_GROCERIES");
    // Cash back is a reward, not money paid in from checking: it must never be matched to one.
    expect(into("CASHBACK BONUS REDEMPTION", { bankCategory: "Payments and Credits" })).toBe(
      "INCOME_OTHER",
    );
    expect(into("REFUND", { bankCategory: "Payments and Credits" })).toBe(
      "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    );
    // A prefix only where the name ends in "-": "Merchandise" isn't "Merchandise & Supplies".
    expect(out("CORNER SHOP", { bankCategory: "Merchandise" })).toBe(
      "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
    );
  });

  it("reads the Bank of America card's interest line as interest", () => {
    expect(out("INTEREST CHARGED ON PURCHASES")).toBe("BANK_FEES_INTEREST_CHARGE");
  });

  it("leaves other bill payments alone", () => {
    expect(out("COMCAST BILL PAYMENT")).not.toBe("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  });

  it.each([
    ["NETFLIX.COM NETFLIX.COM CA 10/14", "ENTERTAINMENT_TV_AND_MOVIES"],
    ["Spotify USA", "ENTERTAINMENT_MUSIC_AND_AUDIO"],
    ["SQ *BLUE BOTTLE COFFEE #123 OAKLAND CA", "FOOD_AND_DRINK_COFFEE"],
    ["WHOLEFDS MKT 10234", "FOOD_AND_DRINK_GROCERIES"],
    ["UBER   *TRIP HELP.UBER.COM CA", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"],
    ["UBER EATS 8005928996", "FOOD_AND_DRINK_RESTAURANT"],
    ["UBER   *EATS", "FOOD_AND_DRINK_RESTAURANT"],
    ["CHIPOTLE 2291", "FOOD_AND_DRINK_FAST_FOOD"],
    ["H-E-B #602", "FOOD_AND_DRINK_GROCERIES"],
    ["BEST BUY 00012345", "GENERAL_MERCHANDISE_ELECTRONICS"],
    // Debugger 11-01: Best Buy's online orders read "BESTBUY.COM", one word, and got no category.
    ["Debit Card Purchase - BESTBUY.COM 888-237-8289 MN", "GENERAL_MERCHANDISE_ELECTRONICS"],
    ["HOME DEPOT #6612", "HOME_IMPROVEMENT_HARDWARE"],
    ["NYTIMES*NYTDIGITAL", "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS"],
    ["GOOGLE *YouTubePremium", "ENTERTAINMENT_TV_AND_MOVIES"],
    ["AMZN Mktp US*2K4L91RT0", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"],
    ["GEICO *AUTO 800-841-3000 DC", "GENERAL_SERVICES_INSURANCE"],
    ["T-MOBILE AUTO PAY", "RENT_AND_UTILITIES_TELEPHONE"],
    ["MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES"],
    // Debugger 11-01: a credit union's $5 "PAPER STATEMENT FEE" read as "Review your Paper
    // Statement Fee subscription", a plan to cancel instead of a fee to have waived.
    ["PAPER STATEMENT FEE", "BANK_FEES_OTHER_BANK_FEES"],
    ["STATEMENT FEE", "BANK_FEES_OTHER_BANK_FEES"],
    ["STOP PAYMENT FEE", "BANK_FEES_OTHER_BANK_FEES"],
    // Debugger 11-01: a Bank of America card's "ANNUAL FEE" read as "Review your Annual Fee
    // subscription", a plan to cancel rather than a card's fee to have waived.
    ["ANNUAL FEE", "BANK_FEES_OTHER_BANK_FEES"],
    ["ANNUAL CARD FEE", "BANK_FEES_OTHER_BANK_FEES"],
    ["YEARLY FEE", "BANK_FEES_OTHER_BANK_FEES"],
    ["ANNUAL FEE FOR 10/2026", "BANK_FEES_OTHER_BANK_FEES"],
    ["NON-CHASE ATM FEE-WITH", "BANK_FEES_ATM_FEES"],
    ["OVERDRAFT FEE FOR A $40.00 ITEM", "BANK_FEES_OVERDRAFT_FEES"],
    ["PURCHASE INTEREST CHARGE", "BANK_FEES_INTEREST_CHARGE"],
    ["CASH ADVANCE INTEREST CHARGE", "BANK_FEES_CASH_ADVANCE"],
    ["LATE FEE", "BANK_FEES_LATE_FEES"],
    ["FOREIGN TRANSACTION FEE", "BANK_FEES_FOREIGN_TRANSACTION_FEES"],
    ["Payment to Chase card ending in 1234 10/07", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
    ["Zelle payment to Sam Example JPM99a1b2c3d", "TRANSFER_OUT_ACCOUNT_TRANSFER"],
  ])("puts outgoing %j in %s", (description, category) => {
    expect(out(description)).toBe(category);
  });

  it.each([
    ["ACME CORP PAYROLL PPD ID: 9876543210", "INCOME_SALARY"],
    ["INTEREST PAYMENT", "INCOME_INTEREST_EARNED"],
    ["Zelle payment from Sam Example", "TRANSFER_IN_ACCOUNT_TRANSFER"],
    ["Payment Thank You-Mobile", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
  ])("puts incoming %j in %s", (description, category) => {
    expect(into(description)).toBe(category);
  });

  it("respects direction: payroll going out is not income", () => {
    expect(out("PAYROLL SERVICE CO")).toBeNull();
  });

  it("matches whole words only", () => {
    expect(out("TUBER FARMS")).toBeNull();
    expect(out("TARGETED ADS LLC")).toBeNull();
  });

  it("falls back to the bank's own labels", () => {
    expect(out("SOMETHING", { bankType: "FEE_TRANSACTION" })).toBe("BANK_FEES_OTHER_BANK_FEES");
    expect(out("CORNER MARKET", { bankCategory: "Groceries" })).toBe("FOOD_AND_DRINK_GROCERIES");
    expect(into("CORNER MARKET", { bankCategory: "Groceries" })).toBeNull();
  });

  // Messy-bank QA: what real checking accounts and card exports write.
  it.each([
    ["CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
    ["AMEX EPAYMENT ACH PMT W4562", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
    ["CAPITAL ONE ONLINE PMT 9F2K", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
    ["DISCOVER E-PAYMENT 7731", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
    ["RIVERSIDE PROPERTY MGMT RENT PPD ID: 5550001", "RENT_AND_UTILITIES_RENT"],
    ["PG&E WEB ONLINE PPD ID: 9471234567", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"],
    ["SQ *JOES COFFEE 4421", "FOOD_AND_DRINK_COFFEE"],
  ])("puts the messy outgoing %j in %s", (description, category) => {
    expect(out(description)).toBe(category);
  });

  it("never files a car rental as rent", () => {
    expect(out("ENTERPRISE RENT-A-CAR 1234")).not.toBe("RENT_AND_UTILITIES_RENT");
  });

  it("counts Social Security and a pension as income", () => {
    expect(into("SSA TREAS 310 XXSOC SEC")).toBe("INCOME_RETIREMENT_PENSION");
    expect(into("STATE TEACHERS RETIREMENT SYS PENSION")).toBe("INCOME_RETIREMENT_PENSION");
    expect(out("PENSION SERVICES LLC")).toBeNull();
  });

  it("files ticket sellers as events, even under the card's own category", () => {
    const events = "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS";
    expect(out("TICKETMASTER 800-653-8000", { bankCategory: "Entertainment" })).toBe(events);
    expect(out("STUBHUB 866-788-2482")).toBe(events);
    expect(out("CITY PARKING TICKETS")).toBe("TRANSPORTATION_PARKING");
    expect(out("GAMETIME*TICKETS")).toBe(events);
    expect(out("ROXY FILM CENTER")).toBe("ENTERTAINMENT_TV_AND_MOVIES");
  });

  it("files utilities named for what they sell as utilities", () => {
    expect(out("XCEL ENERGY-PSCO PPD ID: 8840011")).toBe("RENT_AND_UTILITIES_GAS_AND_ELECTRICITY");
    expect(out("SOUTHERN CALIFORNIA EDISON")).toBe("RENT_AND_UTILITIES_GAS_AND_ELECTRICITY");
    expect(out("SEATTLE CITY LIGHT UTILITIES")).toBe("RENT_AND_UTILITIES_OTHER_UTILITIES");
    expect(into("XCEL ENERGY REFUND")).toBeNull();
  });

  it("counts a payout for one's own work as income, not a refund", () => {
    expect(into("STRIPE TRANSFER ST-K3J9Q2 PPD ID: 4270465600")).toBe("INCOME_CONTRACTOR");
    expect(out("STRIPE TRANSFER ST-K3J9Q2")).not.toBe("INCOME_CONTRACTOR");
  });

  it("uses a card's own categories, both ways, so a return nets against its purchase", () => {
    const shop = { bankCategory: "Shopping" };
    expect(out("CRATE & BARREL 0412", shop)).toBe("GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE");
    expect(into("CRATE & BARREL 0412", shop)).toBe("GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE");
    expect(out("SQ *LITTLE STAR", { bankCategory: "Food & Drink" })).toBe(
      "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
    );
    // A keyword still wins over the card's broad label.
    expect(out("NETFLIX.COM", { bankCategory: "Shopping" })).toBe("ENTERTAINMENT_TV_AND_MOVIES");
  });

  it("calls anything paid through Toast a restaurant, unless a name says more", () => {
    expect(out("TST* PHO HOA NOODLE")).toBe("FOOD_AND_DRINK_RESTAURANT");
    expect(out("PURCHASE AUTHORIZED ON 10/02 TST*CORNER BISTRO S386 CARD 1234")).toBe(
      "FOOD_AND_DRINK_RESTAURANT",
    );
    expect(out("TST* BLUE BOTTLE COFFEE")).toBe("FOOD_AND_DRINK_COFFEE");
    expect(out("SQ *CORNER STUDIO")).toBeNull();
  });

  it("reads what kind of place it is from the words in its name", () => {
    expect(out("PHO HOA NOODLE 22")).toBe("FOOD_AND_DRINK_RESTAURANT");
    expect(out("BRIGHT NOW DENTAL")).toBe("MEDICAL_DENTAL_CARE");
    expect(out("MIDAS MUFFLER #221")).toBe("GENERAL_SERVICES_AUTOMOTIVE");
    expect(out("LUXE NAILS SALON")).toBe("PERSONAL_CARE_HAIR_AND_BEAUTY");
    // A name still wins: Taco Bell is fast food.
    expect(out("TACO BELL #1234")).toBe("FOOD_AND_DRINK_FAST_FOOD");
  });

  it("files a bar, a bakery, a church, insurance and a loan payment by their own words", () => {
    expect(out("HOLLOW OAK TAVERN")).toBe("FOOD_AND_DRINK_RESTAURANT");
    expect(out("BLUE HERON BAKERY")).toBe("FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK");
    expect(out("PARKSIDE COMMUNITY CHURCH")).toBe("GOVERNMENT_AND_NON_PROFIT_DONATIONS");
    expect(out("LEMONADE INSURANCE")).toBe("GENERAL_SERVICES_INSURANCE");
    expect(out("HARBOR CREDIT UNION PMT")).toBe("LOAN_PAYMENTS_OTHER_PAYMENT");
  });

  it("reads landlords, phone and internet companies, taxis, cinemas and markets by their words", () => {
    expect(out("ESSEX PROPERTY TR AUTOPAY")).toBe("RENT_AND_UTILITIES_RENT");
    expect(out("COUNTY PROPERTY TAX")).toBe("GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT");
    expect(out("NORTHSTAR WIRELESS")).toBe("RENT_AND_UTILITIES_TELEPHONE");
    expect(out("Debit Card Purchase - MINT MOBILE")).toBe("RENT_AND_UTILITIES_TELEPHONE");
    expect(out("GOOGLE *FI ABC123")).toBe("RENT_AND_UTILITIES_TELEPHONE");
    expect(out("CRICKET WIRELESS 800")).toBe("RENT_AND_UTILITIES_TELEPHONE");
    expect(out("HILLTOP COMMUNICATIONS")).toBe("RENT_AND_UTILITIES_INTERNET_AND_CABLE");
    expect(out("YELLOW CAB 4411")).toBe("TRANSPORTATION_TAXIS_AND_RIDE_SHARES");
    expect(out("ROXY CINEMA 2")).toBe("ENTERTAINMENT_TV_AND_MOVIES");
    expect(out("DIRECTV STREAM")).toBe("ENTERTAINMENT_TV_AND_MOVIES");
    expect(out("FULTON FISH MARKET")).toBe("FOOD_AND_DRINK_GROCERIES");
    expect(out("ACME TRANSFER 0042")).toBe("TRANSFER_OUT_ACCOUNT_TRANSFER");
  });

  // Debugger 10-30: carriers bill under shorter names than their brand ("TMOBILE AUTOPAY",
  // "VZWRLSS*APOCC VISB", "ATT*BILL PAYMENT"). Each fell through to the same-price rule and came
  // up as "Review your Tmobile Autopay subscription, save $1,020 a year", while the phone check
  // said it had no data.
  it.each([
    "TMOBILE AUTOPAY",
    "TMOBILE*AUTO PAY",
    "TMOBILE POSTPAID WEB",
    "T MOBILE BILL PAY",
    "T-MOBILE PCS SVC",
    "VZWRLSS*APOCC VISB",
    "VZWRLSS*MY VZ VB P",
    "VZW WEBPAY",
    "ATT*BILL PAYMENT",
    "ATT* BILL PAYMENT",
    "ATT BILL PAYMENT",
    "AT T MOBILITY",
    "VISIBLE SERVICE",
    "TING MOBILE",
    "ULTRA MOBILE",
    "PAGE PLUS CELLULAR",
    "XFINITY MOBILE",
    "SPECTRUM MOBILE",
  ])("reads %s as a phone bill, not a subscription", (description) => {
    expect(out(description)).toBe("RENT_AND_UTILITIES_TELEPHONE");
  });

  // Debugger 10-30: a freelancer's Covered California premium was uncategorized.
  it.each([
    "COVERED CALIFORNIA PREMIUM",
    "BLUE SHIELD OF CA PREMIUM",
    "MOLINA HEALTHCARE",
    "AMBETTER HEALTH",
    "HIGHMARK BCBS",
    "PREMERA BLUE CROSS",
    "REGENCE BLUESHIELD",
    "CAREFIRST BCBS",
    "HEALTH NET OF CA",
  ])("reads %s as insurance", (description) => {
    expect(out(description)).toBe("GENERAL_SERVICES_INSURANCE");
  });

  it.each([
    "MATTRESS FIRM",
    "BATTERY PLUS",
    "VISIBLE BODY APP",
    "COMCAST CABLE COMM",
    "MOLINAS TAQUERIA",
  ])("doesn't read %s as a phone bill", (description) => {
    expect(out(description)).not.toBe("RENT_AND_UTILITIES_TELEPHONE");
  });

  // CSV bench, round 12: well-known chains by name, and more kinds of place by their words.
  it.each([
    ["GREYSTAR RE PAYMENT WEB PMT PPD ID: 1839429794", "RENT_AND_UTILITIES_RENT"],
    ["TFL TRAVEL CH LONDON", "TRANSPORTATION_PUBLIC_TRANSIT"],
    ["MTA*NYCT PAYGO NEW YORK NY", "TRANSPORTATION_PUBLIC_TRANSIT"],
    ["PRET A MANGER LONDON GBR", "FOOD_AND_DRINK_FAST_FOOD"],
    ["BLINKIST DENVER CO", "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS"],
    ["SHELL OIL 57442", "TRANSPORTATION_GAS"],
    ["WAWA 8123", "TRANSPORTATION_GAS"],
    ["LIDL US 0412", "FOOD_AND_DRINK_GROCERIES"],
    ["DOLLAR TREE #4410", "GENERAL_MERCHANDISE_DISCOUNT_STORES"],
    ["E-ZPASS NY REBILL", "TRANSPORTATION_TOLLS"],
    ["HAMPTON INN AUSTIN", "TRAVEL_LODGING"],
    ["HERTZ RENT-A-CAR", "TRAVEL_RENTAL_CARS"],
    ["XCEL ENERGY", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"],
    ["WASTE MANAGEMENT", "RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT"],
    ["JIFFY LUBE 1123", "GENERAL_SERVICES_AUTOMOTIVE"],
    ["MAPLE CURRY HOUSE", "FOOD_AND_DRINK_RESTAURANT"],
    ["SUNNY SIDE CREAMERY", "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK"],
    ["RIVERSIDE FLORIST", "GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES"],
    ["BRIGHT STAR CLEANERS", "PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING"],
    ["USPS PO 0523", "GENERAL_SERVICES_POSTAGE_AND_SHIPPING"],
    ["LITTLE ACORNS DAYCARE", "GENERAL_SERVICES_CHILDCARE"],
    ["IRONWORKS FITNESS", "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS"],
  ])("reads %s as %s", (description, category) => {
    expect(out(description)).toBe(category);
  });

  // A name above still wins, and a word many names share isn't taken for a chain.
  it("keeps the names above and leaves common words alone", () => {
    expect(out("ACADEMY SPORTS 0042")).toBe("GENERAL_MERCHANDISE_SPORTING_GOODS");
    expect(out("DIRECTV STREAM")).toBe("ENTERTAINMENT_TV_AND_MOVIES");
    // USAA is a bank as well as an insurer: its transfers are not insurance.
    expect(out("USAA FUNDS TRANSFER")).toBe("TRANSFER_OUT_ACCOUNT_TRANSFER");
    expect(out("USAA P&C AUTOPAY")).toBe("GENERAL_SERVICES_INSURANCE");
    expect(out("GAP INSURANCE")).toBe("GENERAL_SERVICES_INSURANCE");
  });

  // CSV bench, second tuning set: fixed monthly amounts that aren't plans, by their words.
  it.each([
    ["AFFIRM *PAY 3K9L2", "LOAN_PAYMENTS_OTHER_PAYMENT"],
    ["KLARNA* NIKE", "LOAN_PAYMENTS_OTHER_PAYMENT"],
    ["AFTERPAY US", "LOAN_PAYMENTS_OTHER_PAYMENT"],
    ["LAKESHORE AUTO FIN", "LOAN_PAYMENTS_CAR_PAYMENT"],
    ["GM FINANCIAL ONLINE", "LOAN_PAYMENTS_CAR_PAYMENT"],
    ["ACORNS INVEST", "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"],
    ["BETTERMENT 4410", "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"],
    ["OAK RIDGE HOA", "RENT_AND_UTILITIES_OTHER_UTILITIES"],
    ["NEW HOPE CHAPEL", "GOVERNMENT_AND_NON_PROFIT_DONATIONS"],
    ["BETH SHALOM TEMPLE", "GOVERNMENT_AND_NON_PROFIT_DONATIONS"],
    ["SUNNYSIDE PASTRY", "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK"],
    ["BARKBOX", "GENERAL_MERCHANDISE_PET_SUPPLIES"],
    // Night QA 10-30: a couple's Wells Fargo mortgage and PG&E.
    ["WF HOME MTG AUTO PAY", "LOAN_PAYMENTS_MORTGAGE_PAYMENT"],
    ["PGANDE WEB ONLINE", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"],
    // Night QA 10-30: a person paid monthly, Bank of America checking.
    ["TOYOTA MOTOR CR DES:AUTO PMT ID:XXXXX", "LOAN_PAYMENTS_CAR_PAYMENT"],
    ["SMUD DES:UTIL BILL ID:XXXXX", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"],
    ["RALEYS #322", "FOOD_AND_DRINK_GROCERIES"],
    ["HEALTHEQUITY DES:HSA CONTRB ID:XXXXX", "TRANSFER_OUT_ACCOUNT_TRANSFER"],
    // Night QA 10-30: a retiree's college savings and Medicare supplement.
    ["SCHOLARSHARE 529 CONTRIB", "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"],
    ["MY529 CONTRIBUTION", "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"],
    ["BLUE SHIELD MEDICARE SUPP", "GENERAL_SERVICES_INSURANCE"],
  ])("reads %s as %s", (description, category) => {
    expect(out(description)).toBe(category);
  });

  // Debugger 11-01: a freelancer's Bank of America lines put "DES:" between the company and the
  // entry: six Stripe payouts ($14,086) read as transfers between her own accounts, so the tax
  // estimate saw a fraction of her income, and the IRS estimated payment had no category.
  it("reads a Bank of America ACH line's company and entry as one phrase", () => {
    const stripe = "STRIPE DES:TRANSFER ID:ST-XXXXX INDN:TAYLOR EXAMPLE CO ID:XXXXX CCD";
    expect(
      categorizeByRules({ description: stripe, amountCents: -285_000, hints: {} })?.detailed,
    ).toBe("INCOME_CONTRACTOR");
    expect(out("IRS DES:USATAXPYMT ID:XXXXX7781 INDN:TAYLOR EXAMPLE CO ID:XXXXX CCD")).toBe(
      "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
    );
  });

  it("leaves a gym's yearly fee to the gym", () => {
    const out = categorizeByRules({
      description: "PLANET FITNESS ANNUAL FEE AUSTIN TX",
      amountCents: 4_900,
      hints: {},
    })?.detailed;
    expect(out).not.toMatch(/^BANK_FEES/);
  });

  // Night QA 10-30: a driver's pay from Uber, Lyft and DoorDash read as refunds of rides and meals.
  it.each([
    ["UBER USA 6787 EDI PAYMNT"],
    ["LYFT INC PAYOUT"],
    ["DOORDASH DASHER PAYOUT"],
    ["INSTACART SHOPPER PAYOUT"],
    ["AMAZON FLEX DEPOSIT"],
  ])("reads %s, money in, as gig pay", (description) => {
    expect(categorizeByRules({ description, amountCents: -45_000, hints: {} })?.detailed).toBe(
      "INCOME_GIG_ECONOMY",
    );
  });

  // Night QA 10-30: a student's financial aid read as a $2,100 refund of spending.
  it.each([["FAFSA DISBURSEMENT UC REFUND"], ["UCLA FINANCIAL AID"], ["PELL GRANT REFUND"]])(
    "reads %s, money in, as aid paid out, not spending or pay",
    (description) => {
      expect(categorizeByRules({ description, amountCents: -210_000, hints: {} })?.detailed).toBe(
        "LOAN_DISBURSEMENTS_STUDENT",
      );
    },
  );

  // Night QA 10-30: money in with no category netted against spending as a refund.
  it.each([
    ["LIGHTSTREAM LOAN DEPOSIT", "LOAN_DISBURSEMENTS_PERSONAL"],
    ["SOFI LENDING CORP LOAN PROCEEDS", "LOAN_DISBURSEMENTS_PERSONAL"],
    ["UPSTART NETWORK LOAN", "LOAN_DISBURSEMENTS_PERSONAL"],
    ["CA FTB TAX REFUND", "INCOME_TAX_REFUND"],
    ["TAX PRODUCTS PE1 SBTPG LLC", "INCOME_TAX_REFUND"],
    ["EDD UI BENEFITS", "INCOME_UNEMPLOYMENT"],
    ["VA BENEFITS TREAS 310", "INCOME_MILITARY"],
    ["DEPOSIT - DFAS-CLEVELAND MIL PAY", "INCOME_MILITARY"],
    ["CHILD SUPPORT PAYMENT", "INCOME_CHILD_SUPPORT"],
    ["COINBASE INC", "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS"],
    ["FID BKG SVC LLC MONEYLINE", "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS"],
    ["HSA REIMBURSEMENT", "TRANSFER_IN_ACCOUNT_TRANSFER"],
    ["FIDELITY IRA DISTRIBUTION", "INCOME_RETIREMENT_PENSION"],
    ["VANGUARD RMD DISTRIBUTION", "INCOME_RETIREMENT_PENSION"],
    ["TIAA ANNUITY PAYMENT", "INCOME_RETIREMENT_PENSION"],
    ["CALPERS RETIREMENT", "INCOME_RETIREMENT_PENSION"],
    ["SCHWAB DIVIDEND", "INCOME_DIVIDENDS"],
    ["AIRBNB PAYMENTS", "INCOME_RENTAL"],
    ["VRBO PAYOUT", "INCOME_RENTAL"],
    ["DISABILITY BENEFIT", "INCOME_LONG_TERM_DISABILITY"],
    ["WORKERS COMP", "INCOME_OTHER"],
    // Still a student's aid, not a personal loan.
    ["DIRECT LOAN DISB UC", "LOAN_DISBURSEMENTS_STUDENT"],
  ])("reads %s, money in, as %s", (description, category) => {
    expect(categorizeByRules({ description, amountCents: -150_000, hints: {} })?.detailed).toBe(
      category,
    );
  });

  it("still reads an Airbnb stay, money out, as lodging", () => {
    expect(out("AIRBNB * HMQ4XYZ")).toBe("TRAVEL_LODGING");
  });

  // Night QA 10-30: a payday loan landing in checking read as a $400 refund of spending.
  it.each([["ADVANCE AMERICA LOAN"], ["EARNIN TRANSFER"], ["DAVE INC ADVANCE"]])(
    "reads %s, money in, as a cash advance",
    (description) => {
      expect(categorizeByRules({ description, amountCents: -40_000, hints: {} })?.detailed).toBe(
        "LOAN_DISBURSEMENTS_CASH_ADVANCES",
      );
    },
  );

  // Night QA 10-30: a traveller's Paris metro and bakery were uncategorized.
  it("reads the Paris metro and a boulangerie", () => {
    expect(out("RATP PARIS")).toBe("TRANSPORTATION_PUBLIC_TRANSIT");
    expect(out("BOULANGERIE PAUL PARIS")).toBe(out("BLUE HERON BAKERY"));
  });

  // Night QA 10-30: a student's dining hall and a Midwest gas chain had no category.
  it("reads a college dining hall and a Holiday station", () => {
    expect(out("UC DINING HALL")).toBe("FOOD_AND_DRINK_RESTAURANT");
    expect(out("HOLIDAY STATIONSTORES 0412")).toBe("TRANSPORTATION_GAS");
  });

  it("reads 7-Eleven as a convenience store", () => {
    expect(out("7-ELEVEN 33421")).toBe("GENERAL_MERCHANDISE_CONVENIENCE_STORES");
  });

  it("still reads a ride, a meal and a refund of one as what they are", () => {
    expect(out("UBER *TRIP HELP.UBER.COM")).toBe("TRANSPORTATION_TAXIS_AND_RIDE_SHARES");
    expect(out("DOORDASH*THAI HOUSE")).toBe("FOOD_AND_DRINK_RESTAURANT");
    expect(
      categorizeByRules({ description: "UBER *TRIP REFUND", amountCents: -1_200, hints: {} })
        ?.detailed,
    ).toBe("TRANSPORTATION_TAXIS_AND_RIDE_SHARES");
  });

  it("lets a place's kind win over the words that come last", () => {
    expect(out("SQ *IRON TEMPLE GYM")).toBe("PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS");
    expect(out("PHO HOA NOODLE 22")).toBe("FOOD_AND_DRINK_RESTAURANT");
    expect(out("LITTLE ACORNS DAYCARE")).toBe("GENERAL_SERVICES_CHILDCARE");
    // Autopay on a bill is the bill, not a car loan.
    expect(out("VERIZON WIRELESS AUTO PMT")).toBe("RENT_AND_UTILITIES_TELEPHONE");
  });

  // CSV bench, second tuning set: software and radio under the names statements use.
  it.each([
    ["INTUIT *QBOOKS ONLINE", "GENERAL_SERVICES_OTHER_GENERAL_SERVICES"],
    ["INTUIT *TURBOTAX", "GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING"],
    ["AUTODESK INC", "GENERAL_SERVICES_OTHER_GENERAL_SERVICES"],
    ["PAYPAL *SIRIUS XM", "ENTERTAINMENT_MUSIC_AND_AUDIO"],
    ["Withdrawal to BANK OF AMERICA ONLINE PMT PMT", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
  ])("reads %s as %s", (description, category) => {
    expect(out(description)).toBe(category);
  });

  // From the life bench (#798): vets before the clinic words, children's care, doctors by kind,
  // a college's offices, a seller's payout.
  it.each([
    ["VCA ANIMAL CLINIC", "MEDICAL_VETERINARY_SERVICES"],
    ["RIVERSIDE VETERINARIAN", "MEDICAL_VETERINARY_SERVICES"],
    ["SUNNY DAY CARE", "GENERAL_SERVICES_CHILDCARE"],
    ["OAK FAMILY MEDICINE", "MEDICAL_PRIMARY_CARE"],
    ["NORTHSIDE DERMATOLOGY", "MEDICAL_PRIMARY_CARE"],
    ["STATE U BURSAR", "GENERAL_SERVICES_EDUCATION"],
  ])("reads %s as %s", (description, category) => {
    expect(out(description)).toBe(category);
  });

  it("reads a marketplace's payout as a seller's income, and a purchase there as shopping", () => {
    expect(into("ETSY PAYOUT 4410")).toBe("INCOME_GIG_ECONOMY");
    expect(out("ETSY.COM*ORDER 12")).toBe("GENERAL_MERCHANDISE_ONLINE_MARKETPLACES");
  });

  it("leaves unknown merchants for the LLM", () => {
    expect(out("MYSTERY SHOP 555")).toBeNull();
  });

  it("returns primary and detailed together", () => {
    expect(categorizeByRules({ description: "NETFLIX", amountCents: 1549, hints: {} })).toEqual({
      primary: "ENTERTAINMENT",
      detailed: "ENTERTAINMENT_TV_AND_MOVIES",
    });
  });
});

describe("taxonomy", () => {
  it("names every detailed category after its primary", () => {
    for (const detailed of ALL_DETAILED) {
      expect(detailed.startsWith(`${categoryOf(detailed)?.primary}_`)).toBe(true);
    }
  });

  it("rejects names outside the taxonomy", () => {
    expect(categoryOf("SUBSCRIPTIONS")).toBeNull();
  });

  it("is Plaid's PFCv2 list, including the v2 renames", () => {
    expect(ALL_DETAILED).toHaveLength(127);
    expect(categoryOf("INCOME_SALARY")?.primary).toBe("INCOME");
    expect(categoryOf("LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT")?.primary).toBe("LOAN_DISBURSEMENTS");
    expect(categoryOf("BANK_FEES_LATE_FEES")?.primary).toBe("BANK_FEES");
    expect(categoryOf("INCOME_WAGES")).toBeNull();
  });
});

// Founder 10-30: a prop trading firm's payouts are earned income, and its evaluation fees and
// resets are what earning it costs, both found by the firm's name. Made-up descriptions.
describe("prop trading firms", () => {
  it.each(["LUCID TRADING PAYOUT ACH CREDIT", "TOPSTEP PAYOUT", "APEX TRADER FUNDING WIRE"])(
    "counts a payout as contractor income: %j",
    (description) => {
      expect(into(description)).toBe("INCOME_CONTRACTOR");
      expect(payoutByRules({ description, amountCents: -150_000, hints: {} })?.primary).toBe(
        "INCOME",
      );
    },
  );

  it.each(["LUCIDTRADING.COM EVALUATION", "LUCID TRADING RESET FEE", "TOPSTEP MONTHLY"])(
    "counts a fee as a service, never a bank fee: %j",
    (description) => {
      expect(out(description)).toBe("GENERAL_SERVICES_OTHER_GENERAL_SERVICES");
      expect(payoutByRules({ description, amountCents: 8_500, hints: {} })).toBeNull();
    },
  );

  it("leaves other money in alone", () => {
    expect(
      payoutByRules({ description: "TRANSFER FROM SAV 4410", amountCents: -5_000, hints: {} }),
    ).toBeNull();
    expect(
      payoutByRules({ description: "GUSTO PAYROLL", amountCents: -5_000, hints: {} }),
    ).toBeNull();
  });
});
