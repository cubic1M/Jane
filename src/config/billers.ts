// Where and how to pay the most common US bills yourself ("Jane prepares, you pay", the
// manual_bill_pay connector, src/lib/connectors/manual-pay/). From the connectors-roadmap research,
// round 8 (2026-11-06): public pages only, nothing signed up for or contacted; each row keeps its
// sources ("biller:" the biller's own page, "third-party:" anything else). Merchants change these
// pages: re-check a row against its sources before relying on it for a real person.
//
// - payUrl: the biller's own pay or sign-in page, when the research found one at https.
// - autopayByDefault: on unless the person turned it off (buy now, pay later), so a manual payment
//   would pay twice.
// - matchTokens: names a payment's bank line may carry. Descriptors vary by bank (Affirm shows 27
//   ways), so they only add confidence: the match is on the exact amount and the days.
// - settleBusinessDays: how long after the day it was paid to look for it.
// - feeCents: a documented guest or card fee that may be added to the amount.

type BillerType =
  | "card_issuer"
  | "student_loan"
  | "auto_lender"
  | "mortgage"
  | "bnpl"
  | "utility"
  | "telecom"
  | "rent_platform";

export type Biller = {
  biller: string;
  type: BillerType;
  payUrl: string | null;
  guestPay: "yes" | "no" | "unverified";
  autopayOffered: boolean;
  autopayByDefault: boolean;
  matchTokens: readonly string[];
  settleBusinessDays: number;
  feeCents: number;
  janeStep: string;
  sources: readonly string[];
};

export const BILLERS: readonly Biller[] = [
  {
    biller: "Chase (credit cards)",
    type: "card_issuer",
    payUrl: "https://www.chase.com/personal/credit-cards/login-epay",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["CHASE", "CHASE CREDIT CRD", "CHASE CARD SERV ONLINE PAYMENT"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill statement balance (or minimum) and a date on/before the due date before 8 PM ET; open login-epay. Match a funding-account debit containing 'CHASE CREDIT CRD' or 'CHASE CARD', exact cents, 0-3 business days after the chosen date; if Liabilities is linked, also check last_payment_amount/date.",
    sources: [
      "biller: https://www.chase.com/personal/credit-cards/login-epay",
      "third-party: https://emma-app.com/who-charged-me/chase",
    ],
  },
  {
    biller: "American Express",
    type: "card_issuer",
    payUrl: null,
    guestPay: "unverified",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["AMERICAN EXPRESS", "AMEX EPAYMENT", "AMEX EPAYMENT ACH PMT", "AMEX BILL PYMT"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill amount + date, open americanexpress.com sign-in (guest pay not confirmed, so don't link to it). Match a debit containing 'AMEX' + 'EPAYMENT' or 'PYMT', exact cents, 0-3 business days.",
    sources: [
      "third-party: https://www.americanexpress.com/en-ca/customer-service/payments-and-billings/faq.pay-card-bill.html (Amex Canada)",
      "third-party: https://moderntreasury.com/journal/bank-statements-descriptors-and-how-do-you-change-them",
      "third-party: https://emma-app.com/who-charged-me/american-express",
      "third-party: https://joingerald.com/learn/debt--credit/amex-epayment-guide",
    ],
  },
  {
    biller: "Capital One (credit cards)",
    type: "card_issuer",
    payUrl: "https://verified.capitalone.com/auth/signin",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: [
      "CAPITAL ONE",
      "CAPITAL ONE MOBILE PMT",
      "CAPITAL ONE MOBILEPMT",
      "CAPITAL ONE AUTOPAY PYMT",
    ],
    settleBusinessDays: 2,
    feeCents: 0,
    janeStep:
      "Prefill amount + date (before 8 PM ET if it's the closing date); open sign-in. Match 'CAPITAL ONE' + ('MOBILE PMT' or 'AUTOPAY PYMT'), exact cents, 0-2 business days. 'AUTOPAY PYMT' is shared with Capital One Auto, so tell them apart by amount.",
    sources: [
      "biller: https://www.capitalone.com/credit-cards/lp/payment-posting-schedule",
      "third-party: https://explaincharges.com/capital-one-mobile-pmt-charge-on-bank-statement/",
    ],
  },
  {
    biller: "Citi (credit cards)",
    type: "card_issuer",
    payUrl: null,
    guestPay: "unverified",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["CITI", "CITI CARD ONLINE PAYMENT", "CITIBANK CRDT CD"],
    settleBusinessDays: 5,
    feeCents: 0,
    janeStep:
      "Prefill amount, set the date at least 1 business day before the due date (5 PM statement-time cutoff); open Citi sign-on. Match 'CITI CARD' or 'CITIBANK' + 'PAYMENT', exact cents, 0-5 business days.",
    sources: [
      "biller: https://www.citi.com/credit-cards/understanding-credit-cards/how-long-does-a-credit-card-payment-take-to-post",
      "third-party: https://emma-app.com/who-charged-me/citi",
      "third-party: https://joingerald.com/learn/banking--payments/pay-citi",
    ],
  },
  {
    biller: "Discover",
    type: "card_issuer",
    payUrl: null,
    guestPay: "no",
    autopayOffered: false,
    autopayByDefault: false,
    matchTokens: [
      "DISCOVER",
      "DISCOVER DC PYMNTS DCIINTNET E-PAYMENT",
      "DISCOVER BANK DC FINOUT DSLWEBPAY PREARRANGE",
    ],
    settleBusinessDays: 5,
    feeCents: 0,
    janeStep:
      "Prefill amount + date 2+ business days before the due date; open discover.com login. Match 'DISCOVER' + ('E-PAYMENT' or 'WEBPAY'), exact cents, 0-5 business days.",
    sources: [
      "biller: https://www.discover.com/mobile/data/footer/faq_pay.html",
      "biller: https://www.discover.com/credit-cards/card-smarts/how-long-credit-card-payment-take-process/",
      "biller: https://www.discover.com/credit-cards/card-smarts/discover-bill-pay/",
      "third-party: https://emma-app.com/who-charged-me/discover",
    ],
  },
  {
    biller: "Bank of America (credit cards)",
    type: "card_issuer",
    payUrl: "https://www.bankofamerica.com/credit-cards/credit-card-payments-statements-faq/",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["BANK OF AMERICA"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill amount + date; open the FAQ/sign-in. Paid from BofA checking, it may show as an internal transfer; paid from another bank, match 'BANK OF AMERICA' (descriptor not documented), exact cents, 0-3 business days.",
    sources: [
      "biller: https://www.bankofamerica.com/credit-cards/credit-card-payments-statements-faq/",
      "biller: https://www.bankofamerica.com/help/cutoff-times/",
    ],
  },
  {
    biller: "Wells Fargo (credit cards)",
    type: "card_issuer",
    payUrl: "https://www.wellsfargo.com/help/online-banking/transfers-faqs/",
    guestPay: "no",
    autopayOffered: false,
    autopayByDefault: false,
    matchTokens: ["WELLS FARGO"],
    settleBusinessDays: 4,
    feeCents: 0,
    janeStep:
      "If funding from a non-WF bank, set the date ≥4 business days before the due date; open WF sign-on. Match 'WELLS FARGO' or 'WF' + 'CARD' (descriptor not documented), exact cents, 0-4 business days.",
    sources: [
      "biller: https://www.wellsfargo.com/help/online-banking/transfers-faqs/",
      "biller: https://retailservices.wellsfargo.com/customer/faqs.html",
    ],
  },
  {
    biller: "U.S. Bank (credit cards)",
    type: "card_issuer",
    payUrl: "https://www.usbank.com/customer-service/knowledge-base/KB0069966.html",
    guestPay: "no",
    autopayOffered: false,
    autopayByDefault: false,
    matchTokens: ["U.S. BANK"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill amount + date, picking the cutoff by funding source (6 PM local vs 7 PM CT); open sign-in. Match 'US BANK' / 'U.S. BANK' + 'PAYMENT' (not documented), exact cents, 0-3 business days.",
    sources: [
      "biller: https://www.usbank.com/customer-service/knowledge-base/KB0069966.html",
      "biller: https://www.usbank.com/online-mobile-banking/bill-pay.html",
    ],
  },
  {
    biller: "Synchrony (store cards)",
    type: "card_issuer",
    payUrl: "https://www.synchrony.com/quickaccess/signin/guestpay",
    guestPay: "yes",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["SYNCHRONY", "SYNCHRONY BANK PAYMENT", "SYNCHRONY BANK"],
    settleBusinessDays: 2,
    feeCents: 0,
    janeStep:
      "Find the store card's Synchrony portal (https://www.synchrony.com/help/find-account), prefill the amount and open guest pay. Match 'SYNCHRONY BANK' (+'PAYMENT'), exact cents, 0-2 business days; several store cards share one descriptor, so tell them apart by amount.",
    sources: [
      "biller: https://www.synchrony.com/consumer-resources/pay-as-guest",
      "biller: https://www.synchrony.com/help/faqs",
      "third-party: https://emma-app.com/who-charged-me/synchrony",
    ],
  },
  {
    biller: "Apple Card (Goldman Sachs; moving to JPMorgan Chase)",
    type: "card_issuer",
    payUrl: "https://card.apple.com",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["APPLE CARD"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill the amount; tell the person to open Wallet > Apple Card > Pay (or card.apple.com). Match by exact cents + date (descriptor not found). Issuer change from Goldman Sachs to JPMorgan Chase was announced 2026-01-07 (about 24 months), so expect the descriptor to change.",
    sources: [
      "biller: https://support.apple.com/en-us/102534",
      "biller: https://support.apple.com/guide/apple-card-web-servicing/make-a-payment-devf5e41667f/web",
      "third-party: https://www.macrumors.com/2026/01/07/jpmorgan-chase-apple-card-takeover/",
    ],
  },
  {
    biller: "Barclays US",
    type: "card_issuer",
    payUrl: "https://cards.barclaycardus.com/banking/onlinepayments/",
    guestPay: "no",
    autopayOffered: false,
    autopayByDefault: false,
    matchTokens: ["BARCLAYS US"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill amount + date; if the date is the cycle date, finish before 7 PM ET; open the Barclays login. Match 'BARCLAYCARD' or 'BARCLAYS' (US descriptor not found), exact cents, 0-3 business days.",
    sources: [
      "biller: https://www.barclaycardus.com/servicing/paymentschedule.action",
      "biller: https://cards.barclaycardus.com/banking/help-center/faqs/Payments/",
    ],
  },
  {
    biller: "MOHELA (federal)",
    type: "student_loan",
    payUrl: "https://mohela.studentaid.gov",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["MOHELA"],
    settleBusinessDays: 5,
    feeCents: 0,
    janeStep:
      "Prefill the amount due + date ≥4 business days before the due date; open the login, or for bill pay give the payee name, account number and PO box. Suggest Auto Pay before 2026-12-31 for the 1% cut. Match 'MOHELA' or 'DEPT OF ED' (not documented), exact cents, 0-5 business days.",
    sources: ["biller: https://mohela.studentaid.gov/DL/resourceCenter/PaymentMethods.aspx"],
  },
  {
    biller: "Nelnet (federal)",
    type: "student_loan",
    payUrl: "https://nelnet.studentaid.gov",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["NELNET"],
    settleBusinessDays: 5,
    feeCents: 0,
    janeStep:
      "Prefill the amount + date 5 business days before the due date; open nelnet.studentaid.gov. Match 'NELNET' (not documented), exact cents, 0-5 business days.",
    sources: [
      "biller: https://nelnet.studentaid.gov/mma-cms-data/loan-info/Clients/Nelnet/documents/pdfs/Nelnet-Statement-Guide.pdf",
    ],
  },
  {
    biller: "Aidvantage (federal)",
    type: "student_loan",
    payUrl: "https://myaccount.aidvantage.studentaid.gov",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["AIDVANTAGE"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill the amount + allocation; open myaccount. Match 'AIDVANTAGE' or 'DEPT EDUCATION' (not documented), exact cents, 0-3 business days.",
    sources: [
      "biller: https://aidvantage.studentaid.gov/ (via search summary of site pages)",
      "biller: https://aidvantage.studentaid.gov/in-repayment/about-payments",
    ],
  },
  {
    biller: "Edfinancial (federal)",
    type: "student_loan",
    payUrl: "https://myaccount.edfinancial.studentaid.gov/",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["EDFINANCIAL"],
    settleBusinessDays: 5,
    feeCents: 0,
    janeStep:
      "Prefill the amount + date; open myaccount. Match 'EDFINANCIAL' or 'DEPT OF ED' (not documented), exact cents, 0-5 business days.",
    sources: [
      "biller: https://edfinancial.studentaid.gov/waystopay",
      "biller: https://edfinancial.studentaid.gov/",
    ],
  },
  {
    biller: "Sallie Mae (private)",
    type: "student_loan",
    payUrl:
      "https://www.salliemae.com/student-loans/manage-your-private-student-loan/prepare-to-pay-your-student-loans/ways-to-make-student-loan-payments/",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["SALLIE MAE", "SALLIE MAE BANK AUTOPAY"],
    settleBusinessDays: 4,
    feeCents: 0,
    janeStep:
      "Prefill the amount + date; for bank bill pay set it ≥10 days before the due date and include the 16-digit Loan Group Number. Match 'SALLIE MAE', exact cents, 0-4 business days.",
    sources: [
      "biller: https://www.salliemae.com/student-loans/manage-your-private-student-loan/prepare-to-pay-your-student-loans/ways-to-make-student-loan-payments/",
      "biller: https://www.salliemae.com/personal-loans/ways-to-make-your-personal-loan-payments/",
      "third-party: https://emma-app.com/who-charged-me/sallie-mae",
    ],
  },
  {
    biller: "SoFi (private / refinance)",
    type: "student_loan",
    payUrl: "https://sofi.mohela.com",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["SOFI"],
    settleBusinessDays: 5,
    feeCents: 0,
    janeStep:
      "Ask which servicer is on the latest notice (sofi.mohela.com or SoFi); prefill the amount; open that portal. Match 'SOFI' or 'MOHELA' (not documented), exact cents, 0-5 business days.",
    sources: [
      "biller: https://sofi.com/sl-servicing-faqs",
      "biller: https://sofi.mohela.com",
      "biller: https://support.sofi.com/hc/en-us/articles/360052826332-How-do-I-cancel-a-payment-for-my-Personal-Loan",
      "biller: https://www.sofi.com/learn/content/benefits-of-student-loan-autopay/",
    ],
  },
  {
    biller: "Navient (now serviced by MOHELA)",
    type: "student_loan",
    payUrl: "https://servicing.mohela.com",
    guestPay: "no",
    autopayOffered: false,
    autopayByDefault: false,
    matchTokens: [
      "NAVIENT",
      "NAVIENT NAVI DEBIT",
      "NAVI ED SERV PP STUDNTLOAN",
      "NAVIENT ONLINE PMT",
      "NAVIENT-FDR AUTOPAY",
    ],
    settleBusinessDays: 5,
    feeCents: 0,
    janeStep:
      "Tell the person Navient loans now pay at servicing.mohela.com; prefill the amount. Match 'MOHELA' first, then the old 'NAVIENT'/'NAVI' patterns, exact cents, 0-5 business days.",
    sources: [
      "biller: https://navient.com/loan-servicing/mohela",
      "biller: https://images.navient.com/navient/docs/NAV066.pdf",
      "third-party: https://emma-app.com/who-charged-me/navient",
    ],
  },
  {
    biller: "Ally Auto",
    type: "auto_lender",
    payUrl: "https://www.ally.com/help/auto/auto-payment/",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["ALLY AUTO"],
    settleBusinessDays: 2,
    feeCents: 0,
    janeStep:
      "Prefill the amount; open Ally login, or for bill pay give the vehicle account number. Match 'ALLY' (not documented), exact cents, 0-2 business days (Ally marks it completed within 24h).",
    sources: [
      "biller: https://www.ally.com/help/auto/auto-payment/",
      "biller: https://www.ally.com/help/auto/auto-pay/",
      "biller: https://www.ally.com/help/auto/pay-by-text/",
    ],
  },
  {
    biller: "Capital One Auto",
    type: "auto_lender",
    payUrl: "https://verified.capitalone.com/auth/signin",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: [
      "CAPITAL ONE AUTO",
      "CAPITAL ONE AUTO CARPAY",
      "CAPITAL ONE AUTO DIRECTPAY",
      "CAPITAL ONE AUTOPAY PYMT",
    ],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill the monthly amount; open sign-in. Match 'CAPITAL ONE AUTO' (+CARPAY/DIRECTPAY), exact cents, 0-3 business days; 'CAPITAL ONE AUTOPAY PYMT' overlaps with card autopay, so check the amount.",
    sources: [
      "biller: https://www.capitalone.com/help-center/contact-us/",
      "biller: https://www.capitalone.com/auto-financing/terms-autoloans/",
      "third-party: https://emma-app.com/who-charged-me/capital-one-auto",
    ],
  },
  {
    biller: "Toyota Financial Services",
    type: "auto_lender",
    payUrl: "https://www.toyotafinancial.com/dss/secure/payments/one-time-payment",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["TOYOTA FINANCIAL SERVICES"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill the amount; open the one-time-payment page (login). Match 'TOYOTA' + ('MOTOR CREDIT' or 'FINANCIAL' or 'LEASE') (not documented), exact cents, 0-3 business days.",
    sources: [
      "biller: https://www.toyotafinancial.com/us/en/planning_tools/ways_to_pay.html",
      "biller: https://www.toyotafinancial.com/us/en/planning_tools/faq/enrolling_in_pay_online/is_there_a_fee_for_using_pay_online.html",
    ],
  },
  {
    biller: "Honda / Acura Financial Services",
    type: "auto_lender",
    payUrl: "https://honda.americanhondafinance.com/s/paymentoptions-prelogin",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["HONDA"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill the amount; open the Honda/Acura login. Match 'AMERICAN HONDA' or 'HONDA FIN' (not documented), exact cents, 0-3 business days.",
    sources: [
      "biller: http://www.hondafinancialservices.com/account-management/payment-options (via search summary)",
    ],
  },
  {
    biller: "Ford Credit",
    type: "auto_lender",
    payUrl: "https://pay.ford.com/",
    guestPay: "yes",
    autopayOffered: false,
    autopayByDefault: false,
    matchTokens: ["FORD CREDIT"],
    settleBusinessDays: 2,
    feeCents: 0,
    janeStep:
      "Prefill the amount; open pay.ford.com (the person enters the account number + SSN last 4 themselves; Jane never types SSN digits). Match 'FORD CREDIT' or 'FORD MOTOR CR' (not documented), exact cents, 0-2 business days.",
    sources: [
      "biller: https://www.ford.com/finance/customer-support/payments/what-is-guest-pay/",
      "biller: https://www.ford.com/finance/ways-to-pay/",
    ],
  },
  {
    biller: "Santander Consumer USA / Chrysler Capital",
    type: "auto_lender",
    payUrl: "https://santanderconsumerusa.com/payments",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["SANTANDER CONSUMER USA"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill the amount and steer to free ACH in MyAccount (or the phone line); flag the debit/PayPal fees. Match 'SANTANDER CONSUMER' or 'CHRYSLER CAPITAL' (not documented), exact cents, 0-3 business days.",
    sources: [
      "biller: https://santanderconsumerusa.com/payments",
      "biller: https://chryslercapital.com/customers/make-a-payment",
    ],
  },
  {
    biller: "Mr. Cooper (now Rocket)",
    type: "mortgage",
    payUrl: null,
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["MR. COOPER"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Tell the person the loan now pays at Rocket.com; prefill the amount (principal + escrow). Match 'ROCKET' or 'MR COOPER' (not documented), exact cents, 0-3 business days; expect the name to change after the move.",
    sources: [
      "biller: https://www.mrcooper.com/help-center/payments/paying-by-phone",
      "biller: https://www.mrcooper.com/help-center/payments/managing-automatic-payments",
    ],
  },
  {
    biller: "Rocket Mortgage",
    type: "mortgage",
    payUrl: null,
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["ROCKET MORTGAGE"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill the amount; open Rocket.com. Match 'ROCKET MORTGAGE' (not documented), exact cents, 0-3 business days.",
    sources: [
      "biller: https://www.rocketmortgage.com/learn/mortgage-self-service (via search summary)",
      "biller: https://www.mrcooper.com/help-center/payments/paying-by-phone",
    ],
  },
  {
    biller: "Wells Fargo Home Mortgage",
    type: "mortgage",
    payUrl: "https://www.wellsfargo.com/mortgage/manage-account/payments/",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["WELLS FARGO HOME MORTGAGE"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill the amount; from a non-WF bank finish by 10 PM PT on a business day; open sign-on. Match 'WELLS FARGO HOME MTG' / 'WF HOME MTG' (not documented), exact cents, 0-3 business days.",
    sources: [
      "biller: https://www.wellsfargo.com/mortgage/manage-account/payments/",
      "biller: https://www.wellsfargo.com/help/online-banking/transfers-faqs/",
    ],
  },
  {
    biller: "Chase Home Lending",
    type: "mortgage",
    payUrl: "https://www.chase.com/personal/mortgage/paying-your-mortgage/general-payment-faqs",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["CHASE HOME LENDING"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Before prefilling a one-time payment, check whether autopay is on (it would double-pay); prefill the amount; finish by 7:30 PM ET on a weekday. Match 'CHASE MTG' / 'CHASE HOME' (not documented), exact cents, 0-3 business days; partial payments sit as 'unapplied funds'.",
    sources: [
      "biller: https://www.chase.com/personal/mortgage/paying-your-mortgage/general-payment-faqs",
    ],
  },
  {
    biller: "Affirm",
    type: "bnpl",
    payUrl: null,
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: true,
    matchTokens: [
      "AFFIRM",
      "AFFIRM.COM PAYMENTS",
      "AFFIRM.COM PAYME",
      "AFFIRM.COM PAYME ... CO ID:XXXXX65600",
    ],
    settleBusinessDays: 2,
    feeCents: 0,
    janeStep:
      "Usually no step needed (AutoPay); if paying early, prefill the installment and open the app. Match 'AFFIRM' (ACH or card), exact installment cents, 0-2 business days; one debit per loan.",
    sources: [
      "biller: https://helpcenter.affirm.com/s/article/payment-issues",
      "biller: https://help.uk.affirm.com/article/using-autopay-uk (UK)",
      "third-party: https://emma-app.com/who-charged-me/affirm",
    ],
  },
  {
    biller: "Klarna (US)",
    type: "bnpl",
    payUrl: null,
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: true,
    matchTokens: ["KLARNA"],
    settleBusinessDays: 2,
    feeCents: 0,
    janeStep:
      "Usually no step needed; for early or custom payments prefill the amount and open the app. Match 'KLARNA' (US descriptor not found; the descriptors found are UK/EU), exact cents, 0-2 business days.",
    sources: [
      "biller: https://www.klarna.com/us/help/payments/how-can-i-pay/",
      "biller: https://cdn.klarna.com/1.0/shared/content/legal/terms/en-us/autopay_authorization_terms",
      "third-party: https://emma-app.com/who-charged-me/klarna",
    ],
  },
  {
    biller: "Afterpay (US)",
    type: "bnpl",
    payUrl: null,
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: true,
    matchTokens: ["AFTERPAY", "AFTERPAY U S IN"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Usually no step needed; for 'Pay all' or a custom early payment prefill the amount and open the app. Match 'AFTERPAY', exact cents; for bank-funded payments allow 2-5 business days.",
    sources: [
      "biller: https://help.afterpay.com/hc/en-us/articles/20165961480089-How-do-I-make-payments",
      "biller: https://help.afterpay.com/hc/en-us/articles/21014684254873-Managing-Your-Payments-Early-Multiple-Custom-and-More",
      "biller: https://help.afterpay.com/hc/en-us/articles/31900730195225-How-do-I-enable-Autopay",
      "third-party: https://emma-app.com/who-charged-me/afterpay",
    ],
  },
  {
    biller: "PG&E",
    type: "utility",
    payUrl: "https://www.pge.com/en/account/manage-my-account/guest-bill-pay.html",
    guestPay: "yes",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["PG&E"],
    settleBusinessDays: 2,
    feeCents: 150,
    janeStep:
      "Steer to the free signed-in bank payment; use guest pay only if the person has no login (warn about the fee). Match 'PGANDE' / 'PG&E' (not documented), amount = bill ± the guest fee (~$1.50; may be a separate line), 0-2 business days.",
    sources: [
      "biller: https://www.pge.com/en/account/billing-and-assistance/pay-my-bill.html",
      "biller: https://www.pge.com/en/account/manage-my-account/guest-bill-pay.html",
      "biller: https://help.pge.com/s/article/How-do-I-make-a-payment-online?language=en_US",
    ],
  },
  {
    biller: "Southern California Edison",
    type: "utility",
    payUrl: "https://www.sce.com/my-account/pay-my-bill",
    guestPay: "yes",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["SOUTHERN CALIFORNIA EDISON"],
    settleBusinessDays: 3,
    feeCents: 165,
    janeStep:
      "Prefill the amount; open Pay as Guest via checking (free). Match 'SO CAL EDISON' / 'SCE' (not documented), exact cents for checking (card adds $1.65), 0-3 business days.",
    sources: [
      "biller: https://www.sce.com/my-account/pay-my-bill",
      "biller: https://www.sce.com/factsheet/paymentoptions",
      "biller: https://www.sce.com/customer-service-center/help-center/billing-payments/paying-your-bill/card-digital-wallet-payment",
    ],
  },
  {
    biller: "Con Edison",
    type: "utility",
    payUrl: "https://www.coned.com/en/accounts-billing/my-account/pay-my-bill-guest",
    guestPay: "yes",
    autopayOffered: false,
    autopayByDefault: false,
    matchTokens: ["CON EDISON"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill the amount; open guest pay with bank. Match 'CON ED' / 'CONSOLIDATED EDISON' (not documented), exact cents, 0-3 business days.",
    sources: [
      "biller: https://www.coned.com/en/accounts-billing/my-account/pay-my-bill-guest",
      "biller: https://www.coned.com/en/accounts-billing/payment-options",
    ],
  },
  {
    biller: "Duke Energy",
    type: "utility",
    payUrl: "https://www.duke-energy.com/pay-as-guest",
    guestPay: "yes",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["DUKE ENERGY"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill the amount; suggest the free Auto Pay draft, otherwise guest pay (warn about the fee). Match 'DUKE ENERGY' / 'DUKEENERGY' (not documented), amount ± convenience fee, 0-3 business days.",
    sources: [
      "biller: https://www.duke-energy.com/pay-as-guest (via search summary)",
      "biller: https://www.duke-energy.com/home/billing/billing-payment-options/pay-now",
      "biller: https://onlineservices.duke-energy.com/mw/billing-faq.asp?ols=true",
    ],
  },
  {
    biller: "Georgia Power",
    type: "utility",
    payUrl: "https://www.georgiapower.com/residential/billing-payment-options.html",
    guestPay: "yes",
    autopayOffered: false,
    autopayByDefault: false,
    matchTokens: ["GEORGIA POWER"],
    settleBusinessDays: 3,
    feeCents: 225,
    janeStep:
      "Prefill the amount; the person enters the account number + access code; use checking (free). Match 'GEORGIA POWER' / 'GA POWER' (not documented), exact cents for bank (card adds $2.25), 0-3 business days.",
    sources: [
      "biller: https://www.georgiapower.com/residential/billing-payment-options.html?hp=rb2_NGP",
      "biller: https://www.georgiapower.com/content/dam/georgia-power/pdfs/residential-pdfs/save-money-and-energy.pdf",
    ],
  },
  {
    biller: "ComEd",
    type: "utility",
    payUrl: "https://secure.comed.com/payments/payonline/guest",
    guestPay: "yes",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["COMED"],
    settleBusinessDays: 2,
    feeCents: 0,
    janeStep:
      "Prefill the amount; the person chooses account number + ZIP (Jane avoids the SSN path). Match 'COMED' / 'COMMONWEALTH EDISON' (not documented), exact cents, 0-2 business days.",
    sources: [
      "biller: https://secure.comed.com/payments/payonline/guest",
      "biller: https://www.comed.com/my-account/my-dashboard/payment-options",
      "biller: https://www.comed.com/PayInPerson",
    ],
  },
  {
    biller: "FPL (Florida Power & Light)",
    type: "utility",
    payUrl: "https://www.fpl.com/account/bill/guest-pay.html",
    guestPay: "yes",
    autopayOffered: false,
    autopayByDefault: false,
    matchTokens: ["FPL"],
    settleBusinessDays: 1,
    feeCents: 0,
    janeStep:
      "Steer to the free bank payment (phone or logged-in Pay Online); guest pay only as a card fallback. Match 'FPL' / 'FLORIDA POWER' (not documented), exact cents for bank, card ± fee, 0-1 business day.",
    sources: [
      "biller: https://www.fpl.com/account/bill/guest-pay.html",
      "biller: https://www.fpl.com/account/bill/pay-online.html",
      "biller: https://www.fpl.com/account/bill/authorized-payment-options.html",
    ],
  },
  {
    biller: "Verizon",
    type: "telecom",
    payUrl: null,
    guestPay: "yes",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["VERIZON"],
    settleBusinessDays: 2,
    feeCents: 0,
    janeStep:
      "Prefill the bill amount; open vzw.com/paymybill (no login). Match 'VERIZON' / 'VZ WIRELESS' (not documented), exact cents, 0-2 business days.",
    sources: [
      "biller: https://www.verizon.com/support/pay-bill-faqs/",
      "biller: https://www.verizon.com/support/residential/account/pay-bill/how-to/",
    ],
  },
  {
    biller: "AT&T",
    type: "telecom",
    payUrl: "https://www.att.com/acctsvcs/fastpay",
    guestPay: "yes",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["AT&T"],
    settleBusinessDays: 1,
    feeCents: 0,
    janeStep:
      "Prefill the amount; for a bank payment, use signed-in checking (guest bank pay only works via PayWithMyBank). Match 'AT&T' / 'ATT' (not documented), exact cents, 0-1 business day.",
    sources: [
      "biller: https://www.att.com/how-to/pay-your-bill",
      "biller: https://www.att.com/support/article/my-account/KM1008660/",
    ],
  },
  {
    biller: "T-Mobile",
    type: "telecom",
    payUrl: "https://www.t-mobile.com/guest-pay",
    guestPay: "yes",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["T-MOBILE", "TMOBILE*POSTPAID", "TMOBILE*AUTO PAY", "T-MOBILE PCS SVC"],
    settleBusinessDays: 1,
    feeCents: 0,
    janeStep:
      "Prefill the amount; open guest pay. Match 'TMOBILE' / 'T-MOBILE' (+POSTPAID/AUTO PAY/PCS SVC), exact cents, 0-1 business day.",
    sources: [
      "biller: https://www.t-mobile.com/guest-pay",
      "biller: https://www.t-mobile.com/support/account/pay-your-bill (403 to fetch; via search summary)",
      "third-party: https://emma-app.com/who-charged-me/t-mobile",
    ],
  },
  {
    biller: "Comcast Xfinity",
    type: "telecom",
    payUrl: null,
    guestPay: "no",
    autopayOffered: false,
    autopayByDefault: false,
    matchTokens: ["COMCAST XFINITY"],
    settleBusinessDays: 5,
    feeCents: 0,
    janeStep:
      "Prefill the amount; open sign-in, or give the person bank bill-pay payee details from their bill. Match 'COMCAST' / 'XFINITY' (not documented), exact cents, 0-5 business days if via bank bill pay.",
    sources: [
      "third-party: https://forums.xfinity.com/conversations/billing/we-retired-quick-pay/65241b00f8fcd3407e3c5705 (Xfinity staff post on community forum)",
      "third-party: https://forums.xfinity.com/conversations/xfinity-mobile/how-do-i-pay-my-xfinity-mobile-bill-answered/68d1754813765646acfbacda",
    ],
  },
  {
    biller: "Spectrum (Charter)",
    type: "telecom",
    payUrl: null,
    guestPay: "no",
    autopayOffered: false,
    autopayByDefault: false,
    matchTokens: ["SPECTRUM"],
    settleBusinessDays: 2,
    feeCents: 0,
    janeStep:
      "Prefill the amount; open spectrum.net sign-in or give the phone number. Match 'SPECTRUM' / 'CHARTER' (not documented), exact cents, 0-2 business days.",
    sources: [
      "biller: https://www.spectrum.net/support/account-and-billing/pay-my-bill (via search summary; page needs cookies)",
      "biller: https://www.spectrum.net/support/account-and-billing/my-spectrum-app-billing-payment",
      "biller: https://www.spectrum.com/business/enterprise/support/faq/account/how-can-i-make-a-payment",
    ],
  },
  {
    biller: "RentCafe (Yardi)",
    type: "rent_platform",
    payUrl: null,
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["RENTCAFE"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Ask for the property's RentCafe link; prefill rent; steer to ACH. Match the property or management company name (platform descriptor not found), exact cents (+ any $0.95 fee), 0-3 business days.",
    sources: [
      "biller: https://www.rentcafe.com/help/is-rentcafe-free/",
      "biller: https://www.rentcafe.com/help/how-to-add-bank-account/",
    ],
  },
  {
    biller: "ResidentPortal (Entrata)",
    type: "rent_platform",
    payUrl: null,
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["RESIDENTPORTAL"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Ask which property and app; prefill rent; steer to ACH. Match the property/management name (not documented), exact cents, 0-3 business days.",
    sources: [
      "biller: https://apps.apple.com/app/id443831139 (ResidentPortal app listing, via search summary)",
      "third-party: https://cdngeneralcf.rentcafe.com/dmslivecafe/3/1773208/3_1773208_24980409.pdf (property guide)",
    ],
  },
  {
    biller: "AppFolio (resident portal)",
    type: "rent_platform",
    payUrl: "https://account.appfolio.com/resident/sign-in",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["APPFOLIO", "FEE POSTS SEPARATELY AS 'APPFOLIO_TXNFEE'"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill rent; open the sign-in. Match the management company name (not 'AppFolio'), exact rent cents, plus an optional separate 'APPFOLIO_TXNFEE' line, 0-3 business days.",
    sources: [
      "biller: https://www.appfolio.com/help/online-portal",
      "biller: https://www.appfolio.com/terms/homeowner_tenant_portal",
    ],
  },
  {
    biller: "Zillow Rent Payments",
    type: "rent_platform",
    payUrl: "https://www.zillow.com/rent/pay-rent-online/",
    guestPay: "no",
    autopayOffered: true,
    autopayByDefault: false,
    matchTokens: ["ZILLOW RENT PAYMENTS"],
    settleBusinessDays: 3,
    feeCents: 0,
    janeStep:
      "Prefill rent; steer to bank (free). Match 'ZILLOW' (not documented), exact cents, 0-3 business days on the renter's debit.",
    sources: [
      "biller: https://www.zillow.com/rental-manager/online-payments-faq/",
      "biller: https://www.zillow.com/rent/pay-rent-online/ (403 to fetch; via search summary)",
    ],
  },
];
