import type { Rule } from "./rule";

// Prop trading firms (founder 10-30): a payout is pay for trading done on one's own (contractor
// income, usually on a 1099-NEC), and evaluation fees, resets and data fees are what earning it
// costs. Named here so both are found by the firm's name, and a payout the bank filed as a
// transfer still counts as income (payoutByRules).
const PROP_FIRMS = [
  "LUCID TRADING",
  "LUCIDTRADING",
  "TOPSTEP",
  "TOPSTEPTRADER",
  "APEX TRADER",
  "APEXTRADERFUNDING",
  "TRADEIFY",
  "MYFUNDEDFUTURES",
  "MY FUNDED FUTURES",
  "TAKE PROFIT TRADER",
  "TAKEPROFITTRADER",
  "FTMO",
  "FUNDEDNEXT",
  "FUNDED NEXT",
  "THE FUNDED TRADER",
  "EARN2TRADE",
  "BULENOX",
  "ALPHA FUTURES",
  "ELITE TRADER FUNDING",
];

export const BANK_LOANS_INCOME: readonly Rule[] = [
  // First: "LUCID TRADING RESET FEE" is the firm's fee, never a bank fee.
  { category: "INCOME_CONTRACTOR", keywords: PROP_FIRMS, direction: "in" },
  // A payment PayPal charged a fee on: goods or services sold (src/data-sources/csv/formats.ts). The
  // name is only the buyer's, so nothing else says it's income (debugger 11-04).
  { category: "INCOME_CONTRACTOR", bankCategory: ["PayPal sale"], direction: "in" },
  { category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES", keywords: PROP_FIRMS, direction: "out" },
  // Bank fees and interest
  { category: "BANK_FEES_OVERDRAFT_FEES", keywords: ["OVERDRAFT", "OD FEE"] },
  {
    category: "BANK_FEES_INSUFFICIENT_FUNDS",
    keywords: ["INSUFFICIENT FUNDS", "NSF FEE", "RETURNED ITEM FEE"],
  },
  // Above the cash withdrawal rule: "ATM WITHDRAWAL NON-BANK FEE" and Wells Fargo's "NON-WF ATM
  // WITHDRAWAL FEE" are the fee, not the cash.
  {
    category: "BANK_FEES_ATM_FEES",
    keywords: [
      "ATM FEE",
      "NON-CHASE ATM",
      "ATM WITHDRAWAL FEE",
      "NON-BANK FEE",
      "ATM SURCHARGE",
      "NON-WF ATM",
    ],
  },
  // A card's own annual fee: the line is the fee ("ANNUAL FEE", Bank of America's way; debugger
  // 11-01: it read as "Review your Annual Fee subscription"). Not a gym's "PLANET FITNESS ANNUAL
  // FEE", which is the membership's yearly price.
  {
    category: "BANK_FEES_OTHER_BANK_FEES",
    pattern: /^(?:ANNUAL (?:CARD )?FEE|YEARLY FEE)\b/,
    direction: "out",
  },
  // A fee given back, however the bank words it (Chase's "FEE REVERSAL"): it nets against the
  // fee, so the fees finding doesn't ask for money already returned (CSV bench).
  {
    category: "BANK_FEES_OTHER_BANK_FEES",
    keywords: ["FEE REVERSAL", "FEE REFUND", "FEE REVERSED", "FEE REBATE"],
    direction: "in",
  },
  {
    category: "BANK_FEES_FOREIGN_TRANSACTION_FEES",
    keywords: ["FOREIGN TRANSACTION FEE", "FOREIGN EXCHANGE FEE", "INTL TRANSACTION FEE"],
  },
  // Cash advance fees and interest have their own category in PFCv2, so they sit above
  // the general interest rule.
  {
    category: "BANK_FEES_CASH_ADVANCE",
    keywords: ["CASH ADVANCE INTEREST", "CASH ADVANCE FEE"],
    direction: "out",
  },
  {
    category: "BANK_FEES_INTEREST_CHARGE",
    keywords: ["INTEREST CHARGE", "INTEREST CHARGED", "PURCHASE INTEREST"],
    direction: "out",
  },
  { category: "BANK_FEES_LATE_FEES", keywords: ["LATE FEE", "LATE PAYMENT FEE"] },
  {
    category: "BANK_FEES_OTHER_BANK_FEES",
    keywords: [
      "MONTHLY SERVICE FEE",
      "SERVICE CHARGE",
      "MAINTENANCE FEE",
      "ANNUAL MEMBERSHIP FEE",
      "WIRE FEE",
      // Debugger 11-01: a credit union's "PAPER STATEMENT FEE" read as a subscription.
      "STATEMENT FEE",
      "STOP PAYMENT FEE",
    ],
  },

  // A card's own line for the payment (debugger 11-03). Only the whole line and only money in:
  // "STRIPE PAYMENT RECEIVED" is someone paying the person.
  {
    category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    pattern: /^PAYMENT RECEIVED(?: -)?(?: THANK YOU)?$/,
    direction: "in",
  },
  // Paying a credit card, from either side. The checking side is written by the card company
  // ("CHASE CREDIT CRD AUTOPAY", "AMEX EPAYMENT"): never spending, since the purchases are
  // already counted on the card (messy-bank QA: $4,607 of card payments counted twice).
  {
    category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    keywords: [
      "PAYMENT TO CHASE CARD",
      "PAYMENT THANK YOU",
      // How the cards of the banks whose CSVs Jane reads write it (upload QA: Bank of America,
      // Citi, Discover and Amex say "PAYMENT - THANK YOU" or "PAYMENT, THANK YOU"; Capital One's
      // checking says "to Capital One card ending 1234", its card "AUTOPAY PYMT"; Bank of
      // America's checking "CREDIT CARD Bill Payment").
      "PAYMENT - THANK YOU",
      "PAYMENT, THANK YOU",
      "CAPITAL ONE AUTOPAY",
      "CAPITAL ONE CARD ENDING",
      "CREDIT CARD BILL PAYMENT",
      "CREDIT CARD PAYMENT",
      "CREDIT CRD AUTOPAY",
      "CREDIT CRD EPAY",
      "CRD AUTOPAY",
      "CARD AUTOPAY",
      "AMEX EPAYMENT",
      "AMERICAN EXPRESS ACH PMT",
      "CAPITAL ONE ONLINE PMT",
      "CAPITAL ONE MOBILE PMT",
      // Capital One's checking paying a Bank of America card (CSV bench, second tuning set).
      "BANK OF AMERICA ONLINE PMT",
      "DISCOVER E-PAYMENT",
      "DISCOVER DIRECTPAY",
      "CITI AUTOPAY",
      "CITI CARD ONLINE PAYMENT",
      "APPLECARD GSBANK PAYMENT",
      "GOLDMAN SACHS BANK APPLE CARD",
      "BK OF AMER VISA ONLINE PMT",
      "WF CREDIT CARD AUTO PAY",
      "SYNCHRONY BANK PAYMENT",
      // Barclays' cards, from checking (debugger 11-01: counted as $1,200 of spending).
      "BARCLAYCARD US PAYMENT",
      "BARCLAYCARD PAYMENT",
      // As issuers write it on a checking statement (debugger 11-02: a TD file's "CAPITAL ONE
      // CRCARDPMT" counted as $1,200 of spending).
      "CRCARDPMT",
      "CCPYMT",
      "CAPITAL ONE PAYMENT",
      "VI/MC ONLINE PMT",
      "CITI CARD ONLINE",
      "CARD EPAY",
      "DISCOVER CARD E-PAYMENT",
      "BARCLAYCARD US CREDITCARD",
      "TARGET CARD SRVC",
      "KOHLS PAYMENT",
      "SYNCB PAYMENT",
      "CREDIT ONE BANK PAYMENT",
      "MERRICK BANK PAYMENT",
      "CARDMEMBER SERV",
      "CREDIT CARD PMT",
    ],
  },
  // Store cards name the shop, so "AMAZON" further down would call paying one shopping (debugger
  // 11-02: $1,200 on top of the card's own purchases). The lender's name plus a payment word, as a
  // lender's name alone can be a savings account (Synchrony).
  {
    category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    pattern:
      /(?<![A-Z0-9])(?:SYNCHRONY|SYNCB|SYF|COMENITY|CBNA|STORECRD|STORE CARD|TARGET CARD|CREDIT SERVICES)(?![A-Z0-9]).*(?<![A-Z0-9])(?:PAYMENT|PAYMNT|PYMT|PMT)(?![A-Z0-9])/,
  },
  // The card's own side, as the card companies write a payment received (CSV bench: Capital
  // One's "MOBILE PYMT", Bank of America's "BA ELECTRONIC PAYMENT", Citi's "AUTOPAY …
  // AUTO-PMT", Discover's "DIRECTPAY FULL BALANCE", Chase's "AUTOMATIC PAYMENT - THANK", cut
  // short). Money coming in only: on checking, an "ONLINE PAYMENT" going out is a bill.
  {
    category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    keywords: [
      "AUTOMATIC PAYMENT",
      "AUTOPAY PAYMENT",
      "AUTOPAY PYMT",
      "AUTO-PMT",
      "ONLINE PAYMENT",
      "MOBILE PAYMENT",
      "MOBILE PYMT",
      "INTERNET PAYMENT",
      "ELECTRONIC PAYMENT",
      "DIRECTPAY",
    ],
    direction: "in",
  },

  // Money that only moved, in words the income rules would take: a brokerage's cash going to and
  // from its money market fund, and a deposit from the person's own app or brokerage (debugger
  // 11-04: a teacher's Fidelity sweeps read as $1,350 a month of income, and a Venmo cash-out as a
  // second employer, so tax was estimated as married). A chimney sweep stays a chimney sweep.
  {
    category: "TRANSFER_IN_ACCOUNT_TRANSFER",
    pattern:
      /REDEMPTION FROM CORE|YOU SOLD .*(?:MONEY MARKET|CASH RESERVES)|(?:BANK|CASH|MONEY MARKET|SETTLEMENT) SWEEP|\bSWEEP (?:FROM|TO)\b|\bTRANSFERRED FROM\b/,
    direction: "in",
  },
  {
    category: "TRANSFER_OUT_ACCOUNT_TRANSFER",
    pattern: /(?:BANK|CASH|MONEY MARKET|SETTLEMENT) SWEEP|\bSWEEP (?:FROM|TO)\b|\bTRANSFERRED TO\b/,
    direction: "out",
  },
  {
    category: "TRANSFER_IN_ACCOUNT_TRANSFER",
    pattern:
      /\bDIR(?:ECT)? DEP\w*\s+(?:VENMO|PAYPAL|CASH APP|SQUARE INC|ZELLE|FIDELITY|SCHWAB|VANGUARD|ROBINHOOD|COINBASE|BETTERMENT|WEALTHFRONT)\b/,
    direction: "in",
  },

  // Income
  // Above the salary rule: these lines often say DIRECT DEP too, and first match wins (debugger
  // 11-02: "CA EDD UI DIRECT DEP" made someone laid off read as salaried, working for the EDD).
  {
    category: "INCOME_UNEMPLOYMENT",
    keywords: [
      "UNEMPLOYMENT",
      "EDD UI",
      "UI BENEFITS",
      "UI BENEFIT",
      "DOL UI",
      "WORKFORCE COMM UI",
      "ESD UI",
    ],
    direction: "in",
  },
  {
    category: "INCOME_MILITARY",
    keywords: ["DFAS", "MIL PAY", "VA BENEFITS", "VA TREAS"],
    direction: "in",
  },
  {
    category: "INCOME_RETIREMENT_PENSION",
    keywords: ["SSI TREAS", "TEACHERS RET"],
    direction: "in",
  },
  // Above the salary rule's DIRECT DEP: a driver's pay isn't a salary.
  { category: "INCOME_GIG_ECONOMY", keywords: ["LYFT DIRECT", "UBER DIRECT"], direction: "in" },
  { category: "INCOME_CHILD_SUPPORT", keywords: ["CHILD SUPPORT", "CHILD SUPP"], direction: "in" },
  { category: "INCOME_OTHER", keywords: ["SEVERANCE"], direction: "in" },
  {
    category: "INCOME_SALARY",
    keywords: [
      "PAYROLL",
      "PAYRLL",
      "PR PAYMENT",
      "DIRECT DEP",
      "DIR DEP",
      "SALARY",
      // How banks and payroll companies write pay (overnight upload QA: "DIRECT DEPOSIT" and
      // Gusto, ADP and Rippling deposits were left for Claude, so pay was missing until then).
      "DIRECT DEPOSIT",
      "DIR DEPOSIT",
      "GUSTO",
      "PAYCHEX",
      "ADP WAGE",
      "WAGE PAY",
      "RIPPLING",
    ],
    direction: "in",
  },
  // Cash and cheques paid in at an ATM, a branch or by phone: money in, not income Jane can name.
  {
    category: "TRANSFER_IN_DEPOSIT",
    keywords: [
      "MOBILE DEPOSIT",
      "REMOTE DEPOSIT",
      "ATM CASH DEPOSIT",
      "ATM DEPOSIT",
      "CASH DEPOSIT",
      "CHECK DEPOSIT",
      "BRANCH DEPOSIT",
    ],
    direction: "in",
  },
  // Social Security and pensions: income, not a refund (accuracy bench: a retiree's whole
  // income went uncategorised, so Jane couldn't tell how they're paid).
  {
    category: "INCOME_RETIREMENT_PENSION",
    keywords: ["SSA TREAS", "SOC SEC", "SOCIAL SECURITY", "PENSION", "RETIREMENT SYS"],
    direction: "in",
  },
  {
    category: "INCOME_INTEREST_EARNED",
    keywords: ["INTEREST PAYMENT", "INTEREST EARNED", "INTEREST PAID"],
    direction: "in",
  },
  {
    category: "INCOME_TAX_REFUND",
    // A state's refund and one paid through a tax preparer (night QA 10-30: "CA FTB TAX
    // REFUND", "TAX PRODUCTS PE1 SBTPG LLC" had no category, so they netted against spending).
    keywords: ["TAX REF", "IRS TREAS", "TAX REFUND", "TAX RFD", "SBTPG", "TAX PRODUCTS"],
    direction: "in",
  },
  // Night QA 10-30: other money in that had no category and netted against spending as a
  // refund: a personal loan landing, unemployment, veterans' and military pay, child support,
  // money back from the person's own brokerage or HSA.
  {
    category: "LOAN_DISBURSEMENTS_PERSONAL",
    keywords: [
      "LIGHTSTREAM",
      "LOAN PROCEEDS",
      "LOAN DEPOSIT",
      "UPSTART",
      "LENDINGCLUB",
      "LENDING CLUB",
      "SOFI LENDING",
      "PROSPER FUNDING",
      "BEST EGG",
    ],
    direction: "in",
  },
  {
    category: "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS",
    keywords: [
      "COINBASE",
      "ROBINHOOD",
      "MONEYLINE",
      "MONEYLINK",
      "VANGUARD SELL",
      "WEALTHFRONT EDI",
    ],
    direction: "in",
  },
  {
    category: "TRANSFER_IN_ACCOUNT_TRANSFER",
    keywords: ["HSA REIMBURSEMENT", "HSA REIMB"],
    direction: "in",
  },
  // Retirement money, dividends and rent coming in (night QA 10-30: a retiree's IRA
  // distribution and an Airbnb host's payout read as refunds, the payout of travel).
  {
    category: "INCOME_RETIREMENT_PENSION",
    keywords: [
      "IRA DISTRIBUTION",
      "IRA DIST",
      "RMD",
      "ANNUITY",
      "CALPERS",
      "CALSTRS",
      "OPM RETIRE",
      "TIAA",
    ],
    direction: "in",
  },
  { category: "INCOME_DIVIDENDS", keywords: ["DIVIDEND"], direction: "in" },
  {
    category: "INCOME_RENTAL",
    keywords: ["AIRBNB PAYMENTS", "AIRBNB PAYOUT", "VRBO PAYOUT", "RENTAL INCOME"],
    direction: "in",
  },
  { category: "INCOME_LONG_TERM_DISABILITY", keywords: ["DISABILITY"], direction: "in" },
  { category: "INCOME_OTHER", keywords: ["WORKERS COMP"], direction: "in" },
  // Payouts for work done on one's own: income, never a refund that shrinks spending.
  {
    category: "INCOME_CONTRACTOR",
    keywords: ["STRIPE TRANSFER", "STRIPE PAYOUT", "UPWORK", "FIVERR", "SHOPIFY PAYOUT"],
    direction: "in",
  },
  {
    category: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
    keywords: ["IRS USATAXPYMT", "FRANCHISE TAX", "SALES TAX", "CDTFA"],
    direction: "out",
  },

  // Loan payments from checking (overnight upload QA: "MORTGAGE PMT ROCKET MORTGAGE" went
  // uncategorised, so the loans page never saw the mortgage).
  {
    category: "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
    // Wells Fargo writes its own as "WF HOME MTG AUTO PAY" (night QA 10-30: left uncategorized,
    // the month close asked a couple what their $3,240 mortgage was).
    keywords: [
      "MORTGAGE",
      "MTG PMT",
      "MORTGAGE PMT",
      "HOME LOAN PMT",
      "HOME MTG",
      "MTG AUTO PAY",
      "MTG PYMT",
      "MTG PAYMENT",
    ],
    direction: "out",
  },
  {
    category: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
    keywords: ["NAVIENT", "NELNET", "MOHELA", "SALLIE MAE", "AIDVANTAGE", "DEPT EDUCATION"],
    direction: "out",
  },
  {
    category: "LOAN_PAYMENTS_CAR_PAYMENT",
    keywords: [
      "AUTO LOAN",
      "TOYOTA FINANCIAL",
      "HONDA FINANCIAL",
      "ALLY AUTO",
      // Not "CARMAX AUTO" alone: that's also the dealership (debugger 11-03: a car bought by wire).
      "CARMAX AUTO PMT",
      "CARMAX AUTO PAY",
      "CARMAX AUTO LOAN",
      // A car lender by its own words (CSV bench, second tuning set: "LAKESHORE AUTO FIN").
      "AUTO FIN",
      "AUTO FINANCE",
      "MOTOR CREDIT",
      // Bank of America cuts it short (night QA 10-30: "TOYOTA MOTOR CR DES:AUTO PMT").
      "MOTOR CR",
      "FORD CREDIT",
      "GM FINANCIAL",
      "NISSAN MOTOR ACCEPT",
      "HYUNDAI MOTOR FIN",
      "SANTANDER CONSUMER",
      "CAPITAL ONE AUTO",
      "WESTLAKE FINANCIAL",
      "EXETER FINANCE",
    ],
    direction: "out",
  },
  // Buy now, pay later: each instalment pays off a purchase, whatever shop follows the name
  // ("KLARNA* NIKE" is a loan payment, not clothes). CSV bench, second tuning set.
  {
    category: "LOAN_PAYMENTS_OTHER_PAYMENT",
    keywords: [
      "AFFIRM",
      "KLARNA",
      "AFTERPAY",
      "SEZZLE",
      "ZIP.CO",
      "QUADPAY",
      "PAYPAL PAY IN 4",
      "PAY IN 4",
      "APPLE PAY LATER",
      "PAYBRIGHT",
      "SPLITIT",
    ],
    direction: "out",
  },
];
