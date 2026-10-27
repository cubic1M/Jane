import { categoryOf, type Category, type PfcDetailed } from "./taxonomy";
import { normalizeDescription } from "@/data-sources/merchant";
import type { NormalizedTransaction } from "@/data-sources/types";

// Keyword rules come first; only what they can't place goes to the LLM. Order matters:
// the first rule that matches wins, so specific rules (fees, card payments) sit above
// broad merchant ones.

type Direction = "out" | "in";

type Rule = {
  category: PfcDetailed;
  // Matched against the upper-cased description as whole words.
  keywords?: readonly string[];
  // Only for money leaving (out) or entering (in) the account.
  direction?: Direction;
  bankType?: readonly string[];
  bankCategory?: readonly string[];
  // Matched against the upper-cased description, for a shape no keyword names.
  pattern?: RegExp;
};

const RULES: readonly Rule[] = [
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
    ],
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
      "DISCOVER E-PAYMENT",
      "CITI AUTOPAY",
      "CITI CARD ONLINE PAYMENT",
      "APPLECARD GSBANK PAYMENT",
      "BK OF AMER VISA ONLINE PMT",
      "WF CREDIT CARD AUTO PAY",
      "SYNCHRONY BANK PAYMENT",
    ],
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

  // Income
  {
    category: "INCOME_SALARY",
    keywords: ["PAYROLL", "DIRECT DEP", "DIR DEP", "SALARY"],
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
  { category: "INCOME_TAX_REFUND", keywords: ["TAX REF", "IRS TREAS"], direction: "in" },
  // Payouts for work done on one's own: income, never a refund that shrinks spending.
  {
    category: "INCOME_CONTRACTOR",
    keywords: ["STRIPE TRANSFER", "STRIPE PAYOUT", "UPWORK", "FIVERR", "SHOPIFY PAYOUT"],
    direction: "in",
  },
  {
    category: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
    keywords: ["IRS USATAXPYMT", "FRANCHISE TAX"],
    direction: "out",
  },

  // Loan payments from checking (overnight upload QA: "MORTGAGE PMT ROCKET MORTGAGE" went
  // uncategorised, so the loans page never saw the mortgage).
  {
    category: "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
    keywords: ["MORTGAGE", "MTG PMT", "MORTGAGE PMT", "HOME LOAN PMT"],
    direction: "out",
  },
  {
    category: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
    keywords: ["NAVIENT", "NELNET", "MOHELA", "SALLIE MAE", "AIDVANTAGE", "DEPT EDUCATION"],
    direction: "out",
  },
  {
    category: "LOAN_PAYMENTS_CAR_PAYMENT",
    keywords: ["AUTO LOAN", "TOYOTA FINANCIAL", "HONDA FINANCIAL", "ALLY AUTO", "CARMAX AUTO"],
    direction: "out",
  },

  // Rent, even when it goes by Zelle or Venmo (overnight upload QA: "ZELLE TO OAK RIDGE APTS
  // RENT" was a transfer, so a student's biggest bill was missing from spending and bills).
  // Renting a car or clothes is not rent, so those go first.
  {
    category: "TRAVEL_RENTAL_CARS",
    keywords: ["RENT-A-CAR", "RENT A CAR", "CAR RENTAL", "HERTZ", "AVIS", "BUDGET RENT"],
    direction: "out",
  },
  {
    category: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
    keywords: ["RENT THE RUNWAY"],
    direction: "out",
  },
  {
    category: "RENT_AND_UTILITIES_RENT",
    keywords: ["RENT", "APTS", "APARTMENTS", "PROPERTY MGMT", "PROPERTY MANAGEMENT", "LANDLORD"],
    direction: "out",
  },

  // Moving money to one's own savings: not spending (overnight upload QA: "TRANSFER TO SAV
  // XXXXX4410" was uncategorised, so it counted as spending and showed as a $300 bill).
  {
    category: "TRANSFER_OUT_SAVINGS",
    keywords: ["TO SAV", "TO SAVINGS", "SAVINGS TRANSFER", "TRANSFER TO SAVINGS"],
    direction: "out",
  },
  {
    category: "TRANSFER_IN_SAVINGS",
    keywords: ["FROM SAV", "FROM SAVINGS"],
    direction: "in",
  },

  // Transfers between people and accounts
  // Own-account moves as the banks word them (CSV bench: Bank of America's "Online Banking
  // transfer to SAV", Capital One's "Withdrawal to 360 Performance Savings").
  {
    category: "TRANSFER_OUT_ACCOUNT_TRANSFER",
    keywords: [
      "ZELLE",
      "VENMO",
      "CASH APP",
      "TRANSFER TO",
      "360 PERFORMANCE SAVINGS",
      "360 SAVINGS",
    ],
    direction: "out",
  },
  {
    category: "TRANSFER_IN_ACCOUNT_TRANSFER",
    keywords: ["ZELLE", "VENMO", "CASH APP", "TRANSFER FROM", "360 CHECKING"],
    direction: "in",
  },
  {
    category: "TRANSFER_OUT_WITHDRAWAL",
    // Bank of America writes "BKOFAMERICA ATM 10/03 #000001234 WITHDRWL" (CSV bench).
    keywords: ["ATM WITHDRAWAL", "CASH WITHDRAWAL", "WITHDRWL"],
    direction: "out",
  },

  // An airline ticket: card descriptors carry its 13-digit number (a 3-digit airline code, then
  // the ticket), whatever the airline ("UNITED 0162345678901", "SOUTHWES 5262123456789"). So
  // a group's fares aren't a double charge (CSV bench).
  { category: "TRAVEL_FLIGHTS", pattern: /(?<![0-9])[0-9]{13}(?![0-9])/ },

  // Well-known merchants
  {
    category: "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
    keywords: [
      "NYTIMES",
      "NYT DIGITAL",
      "WSJ",
      "WASHINGTON POST",
      "WAPO",
      "THE ATLANTIC",
      "SUBSTACK",
    ],
  },
  {
    category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    keywords: [
      "OPENAI",
      "CHATGPT",
      "ADOBE",
      "DROPBOX",
      "MICROSOFT 365",
      "GOOGLE STORAGE",
      "ICLOUD",
      "APPLE.COM/BILL",
    ],
  },
  {
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    keywords: [
      "NETFLIX",
      "HULU",
      "DISNEY PLUS",
      "DISNEYPLUS",
      "HBO MAX",
      "MAX.COM",
      "PEACOCK",
      "PARAMOUNT+",
      "STARZ",
      "YOUTUBEPREMIUM",
      "YOUTUBE PREMIUM",
      "YOUTUBE TV",
    ],
  },
  {
    category: "ENTERTAINMENT_MUSIC_AND_AUDIO",
    keywords: ["SPOTIFY", "PANDORA", "SIRIUSXM", "AUDIBLE", "TIDAL"],
  },
  {
    category: "ENTERTAINMENT_VIDEO_GAMES",
    keywords: ["STEAMGAMES", "PLAYSTATION", "XBOX", "NINTENDO"],
  },
  {
    category: "FOOD_AND_DRINK_COFFEE",
    keywords: ["STARBUCKS", "DUNKIN", "PEET'S", "PEETS", "BLUE BOTTLE", "COFFEE", "CAFE"],
  },
  {
    category: "FOOD_AND_DRINK_FAST_FOOD",
    keywords: [
      "MCDONALD'S",
      "MCDONALDS",
      "BURGER KING",
      "TACO BELL",
      "WENDY'S",
      "CHICK-FIL-A",
      "CHIPOTLE",
      "SUBWAY",
      "DOMINO'S",
      "PIZZA HUT",
      "PANERA",
      "FIVE GUYS",
      "SHAKE SHACK",
      "POPEYES",
      "KFC",
      "SONIC DRIVE",
      "JACK IN THE BOX",
      "IN-N-OUT",
    ],
  },
  // Sit-down chains, by name; the rest come from the card's own category or Claude.
  {
    category: "FOOD_AND_DRINK_RESTAURANT",
    keywords: [
      "OLIVE GARDEN",
      "APPLEBEE'S",
      "CHILI'S",
      "CHEESECAKE FACTORY",
      "RED ROBIN",
      "IHOP",
      "DENNY'S",
      "OUTBACK",
      "TEXAS ROADHOUSE",
      "BUFFALO WILD WINGS",
      "SWEETGREEN",
      "CAVA",
    ],
  },
  {
    category: "FOOD_AND_DRINK_GROCERIES",
    keywords: [
      "WHOLE FOODS",
      "WHOLEFDS",
      "TRADER JOE",
      "SAFEWAY",
      "KROGER",
      "PUBLIX",
      "ALDI",
      "WEGMANS",
      "SPROUTS",
      "H-E-B",
      "HEB",
      "MEIJER",
      "HY-VEE",
      "FOOD LION",
      "STOP & SHOP",
      "ALBERTSONS",
      "VONS",
      "RALPHS",
      "HARRIS TEETER",
      "WINCO",
      "GIANT EAGLE",
      "FRED MEYER",
    ],
  },
  // Food delivery before ride shares, so "UBER EATS" isn't a taxi.
  {
    category: "FOOD_AND_DRINK_RESTAURANT",
    keywords: ["UBER EATS", "UBER *EATS", "UBEREATS", "DOORDASH", "GRUBHUB", "POSTMATES"],
  },
  { category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES", keywords: ["UBER", "LYFT"] },
  {
    category: "TRANSPORTATION_GAS",
    keywords: ["SHELL OIL", "CHEVRON", "EXXON", "EXXONMOBIL", "MOBIL", "ARCO", "SUNOCO"],
  },
  {
    category: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
    keywords: ["AMAZON", "AMZN", "EBAY", "ETSY"],
  },
  {
    category: "GENERAL_MERCHANDISE_SUPERSTORES",
    keywords: ["TARGET", "WALMART", "WAL-MART", "COSTCO"],
  },
  { category: "MEDICAL_PHARMACIES_AND_SUPPLEMENTS", keywords: ["CVS", "WALGREENS", "RITE AID"] },
  {
    category: "GENERAL_MERCHANDISE_ELECTRONICS",
    keywords: ["BEST BUY", "APPLE STORE", "MICRO CENTER"],
  },
  {
    category: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
    keywords: [
      "TJ MAXX",
      "T J MAXX",
      "TJMAXX",
      "MARSHALLS",
      "ROSS STORES",
      "OLD NAVY",
      "H&M",
      "ZARA",
      "UNIQLO",
      "NORDSTROM RACK",
    ],
  },
  {
    category: "HOME_IMPROVEMENT_HARDWARE",
    keywords: ["HOME DEPOT", "LOWE'S", "LOWES", "ACE HARDWARE", "MENARDS"],
  },
  {
    category: "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
    keywords: ["COMCAST", "XFINITY", "SPECTRUM"],
  },
  { category: "RENT_AND_UTILITIES_TELEPHONE", keywords: ["VERIZON", "AT&T", "T-MOBILE"] },
  // Rent that names no "RENT" (a bare "RENT" is caught above, after car rentals).
  {
    category: "RENT_AND_UTILITIES_RENT",
    keywords: [
      "PROPERTY MGMT",
      "PROPERTY MANAGEMENT",
      "RENT PAYMENT",
      "BILT RENT",
      "RENTCAFE",
      "APPFOLIO",
    ],
    direction: "out",
  },
  {
    category: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
    keywords: [
      "PG&E",
      "CON ED",
      "CONEDISON",
      "DUKE ENERGY",
      "SCE",
      "COMED",
      "NATIONAL GRID",
      // Utilities named for what they sell (accuracy bench: "XCEL ENERGY", "SOUTHERN
      // CALIFORNIA EDISON" were never bills).
      "ENERGY",
      "ELECTRIC",
      "EDISON",
      "GAS & ELECTRIC",
      "GAS CO",
      "GAS COMPANY",
    ],
    direction: "out",
  },
  {
    category: "RENT_AND_UTILITIES_WATER",
    keywords: ["WATER UTIL", "WATER DEPT"],
    direction: "out",
  },
  {
    category: "RENT_AND_UTILITIES_OTHER_UTILITIES",
    keywords: ["UTILITIES", "UTILITY"],
    direction: "out",
  },
  {
    category: "GENERAL_SERVICES_INSURANCE",
    keywords: [
      "GEICO",
      "PROGRESSIVE",
      "STATE FARM",
      "ALLSTATE",
      "LIBERTY MUTUAL",
      "LEMONADE INS",
      "NATIONWIDE",
    ],
  },
  {
    category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
    keywords: ["PLANET FITNESS", "EQUINOX", "ORANGETHEORY", "24 HOUR FITNESS", "PELOTON"],
  },
  { category: "TRAVEL_LODGING", keywords: ["AIRBNB", "MARRIOTT", "HILTON", "HYATT"] },
  // Ticket sellers: a seat each, so two at one price aren't a double charge (accuracy bench).
  {
    category: "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS",
    keywords: [
      "TICKETMASTER",
      "LIVE NATION",
      "STUBHUB",
      "SEATGEEK",
      "VIVID SEATS",
      "EVENTBRITE",
      "AXS",
      "TICKETWEB",
    ],
    direction: "out",
  },
  {
    category: "TRAVEL_FLIGHTS",
    keywords: [
      "DELTA AIR",
      "UNITED AIRLINES",
      "AMERICAN AIRLINES",
      "AMERICAN AIR",
      "SOUTHWEST AIR",
      // Southwest's own card descriptor, cut to eight letters before the ticket number.
      "SOUTHWES",
      "JETBLUE",
      "ALASKA AIR",
      "SPIRIT AIRL",
      "FRONTIER AIRLINES",
    ],
  },

  // Toast ("TST*") is a till for restaurants only: whatever the place is called, it's a meal.
  // After the merchant names, so "TST* BLUE BOTTLE" is still coffee. (Square's "SQ *" serves
  // every kind of shop, so it says nothing.)
  { category: "FOOD_AND_DRINK_RESTAURANT", pattern: /(?:^|\s)TST\s*\*/ },

  // The bank's own labels, when no keyword matched
  { category: "BANK_FEES_OTHER_BANK_FEES", bankType: ["FEE_TRANSACTION", "Fee"] },
  { category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", bankType: ["Payment"] },
  { category: "LOAN_PAYMENTS_OTHER_PAYMENT", bankType: ["LOAN_PMT"], direction: "out" },
  { category: "TRANSFER_OUT_WITHDRAWAL", bankType: ["ATM"], direction: "out" },
  { category: "FOOD_AND_DRINK_GROCERIES", bankCategory: ["Groceries"], direction: "out" },
  { category: "TRANSPORTATION_GAS", bankCategory: ["Gas"], direction: "out" },
  // A card's own categories (Chase's), in either direction, so a return nets against its
  // purchase. Broad, so last: the keyword rules above are more specific.
  { category: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK", bankCategory: ["Food & Drink"] },
  { category: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE", bankCategory: ["Shopping"] },
  { category: "TRAVEL_OTHER_TRAVEL", bankCategory: ["Travel"] },
  { category: "ENTERTAINMENT_OTHER_ENTERTAINMENT", bankCategory: ["Entertainment"] },
  { category: "MEDICAL_OTHER_MEDICAL", bankCategory: ["Health & Wellness"] },
  { category: "RENT_AND_UTILITIES_OTHER_UTILITIES", bankCategory: ["Bills & Utilities"] },
  { category: "TRANSPORTATION_OTHER_TRANSPORTATION", bankCategory: ["Automotive"] },
  { category: "HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT", bankCategory: ["Home"] },
  { category: "PERSONAL_CARE_OTHER_PERSONAL_CARE", bankCategory: ["Personal"] },
  { category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES", bankCategory: ["Professional Services"] },
  { category: "GENERAL_SERVICES_EDUCATION", bankCategory: ["Education"] },
  { category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS", bankCategory: ["Gifts & Donations"] },
  { category: "BANK_FEES_OTHER_BANK_FEES", bankCategory: ["Fees & Adjustments"], direction: "out" },
  // Capital One's and Discover's card categories, and American Express's (its "Category"
  // column, "Restaurant-Restaurant", matched by the part before the dash). CSV bench: none
  // were read, so a card's restaurants were uncategorized without Claude.
  {
    category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    bankCategory: ["Payment/Credit", "Payments and Credits"],
    direction: "in",
  },
  {
    category: "FOOD_AND_DRINK_RESTAURANT",
    bankCategory: ["Dining", "Restaurants", "Restaurant-"],
  },
  {
    category: "FOOD_AND_DRINK_GROCERIES",
    bankCategory: ["Grocery", "Supermarkets", "Merchandise & Supplies-Groceries"],
  },
  {
    category: "TRANSPORTATION_GAS",
    bankCategory: ["Gas/Automotive", "Gasoline", "Transportation-Fuel"],
  },
  { category: "TRAVEL_FLIGHTS", bankCategory: ["Airfare", "Travel-Airline"] },
  { category: "TRAVEL_OTHER_TRAVEL", bankCategory: ["Other Travel", "Travel-"] },
  { category: "TRANSPORTATION_OTHER_TRANSPORTATION", bankCategory: ["Transportation-"] },
  { category: "RENT_AND_UTILITIES_TELEPHONE", bankCategory: ["Phone/Cable", "Communications-"] },
  { category: "MEDICAL_OTHER_MEDICAL", bankCategory: ["Health Care", "Medical Services"] },
  {
    category: "ENTERTAINMENT_OTHER_ENTERTAINMENT",
    bankCategory: ["Travel/ Entertainment", "Entertainment-"],
  },
  { category: "GENERAL_MERCHANDISE_DEPARTMENT_STORES", bankCategory: ["Department Stores"] },
  {
    category: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
    bankCategory: ["Merchandise", "Merchandise & Supplies-"],
  },
  {
    category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    bankCategory: ["Other Services", "Services", "Business Services-"],
  },
  { category: "BANK_FEES_INTEREST_CHARGE", bankCategory: ["Interest"], direction: "out" },
  {
    category: "BANK_FEES_OTHER_BANK_FEES",
    bankCategory: ["Fee/Interest Charge", "Fees"],
    direction: "out",
  },
];

// A bank category ending in "-" is a prefix: American Express writes "Restaurant-Bar & Café".
const bankCategoryMatches = (names: readonly string[], value: string) =>
  names.some((name) => (name.endsWith("-") ? value.startsWith(name) : value === name));

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word match: "UBER" matches "UBER *TRIP" but not "UBEREATS" or "TUBER".
const COMPILED = RULES.map((rule) => ({
  ...rule,
  pattern: rule.keywords
    ? new RegExp(`(?<![A-Z0-9])(?:${rule.keywords.map(escape).join("|")})(?![A-Z0-9])`)
    : (rule.pattern ?? null),
}));

export type RuleInput = Pick<NormalizedTransaction, "description" | "amountCents" | "hints">;

export function categorizeByRules({ description, amountCents, hints }: RuleInput): Category | null {
  const text = normalizeDescription(description);
  const direction: Direction = amountCents >= 0 ? "out" : "in";

  for (const rule of COMPILED) {
    if (rule.direction && rule.direction !== direction) continue;
    const matched =
      (rule.pattern && rule.pattern.test(text)) ||
      (rule.bankType && hints.bankType && rule.bankType.includes(hints.bankType)) ||
      (rule.bankCategory &&
        hints.bankCategory &&
        bankCategoryMatches(rule.bankCategory, hints.bankCategory));
    if (matched) return categoryOf(rule.category);
  }
  return null;
}
