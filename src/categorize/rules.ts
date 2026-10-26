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
};

const RULES: readonly Rule[] = [
  // Bank fees and interest
  { category: "BANK_FEES_OVERDRAFT_FEES", keywords: ["OVERDRAFT", "OD FEE"] },
  {
    category: "BANK_FEES_INSUFFICIENT_FUNDS",
    keywords: ["INSUFFICIENT FUNDS", "NSF FEE", "RETURNED ITEM FEE"],
  },
  { category: "BANK_FEES_ATM_FEES", keywords: ["ATM FEE", "NON-CHASE ATM"] },
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
    keywords: ["INTEREST CHARGE", "PURCHASE INTEREST"],
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

  // Transfers between people and accounts
  {
    category: "TRANSFER_OUT_ACCOUNT_TRANSFER",
    keywords: ["ZELLE", "VENMO", "CASH APP", "ONLINE TRANSFER TO"],
    direction: "out",
  },
  {
    category: "TRANSFER_IN_ACCOUNT_TRANSFER",
    keywords: ["ZELLE", "VENMO", "CASH APP", "ONLINE TRANSFER FROM"],
    direction: "in",
  },
  {
    category: "TRANSFER_OUT_WITHDRAWAL",
    keywords: ["ATM WITHDRAWAL", "CASH WITHDRAWAL"],
    direction: "out",
  },

  // Well-known merchants
  {
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    keywords: ["NETFLIX", "HULU", "DISNEY PLUS", "DISNEYPLUS", "HBO MAX", "PEACOCK", "PARAMOUNT+"],
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
    keywords: ["MCDONALD'S", "MCDONALDS", "BURGER KING", "TACO BELL", "WENDY'S", "CHICK-FIL-A"],
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
    ],
  },
  // Food delivery before ride shares, so "UBER EATS" isn't a taxi.
  {
    category: "FOOD_AND_DRINK_RESTAURANT",
    keywords: ["UBER EATS", "UBEREATS", "DOORDASH", "GRUBHUB"],
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
    category: "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
    keywords: ["COMCAST", "XFINITY", "SPECTRUM"],
  },
  { category: "RENT_AND_UTILITIES_TELEPHONE", keywords: ["VERIZON", "AT&T", "T-MOBILE"] },
  // Not a bare "RENT": "ENTERPRISE RENT-A-CAR" is a car.
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
    keywords: ["PLANET FITNESS", "EQUINOX", "ORANGETHEORY", "24 HOUR FITNESS"],
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
    keywords: ["DELTA AIR", "UNITED AIRLINES", "AMERICAN AIRLINES", "SOUTHWEST AIR", "JETBLUE"],
  },

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
];

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word match: "UBER" matches "UBER *TRIP" but not "UBEREATS" or "TUBER".
const COMPILED = RULES.map((rule) => ({
  ...rule,
  pattern: rule.keywords
    ? new RegExp(`(?<![A-Z0-9])(?:${rule.keywords.map(escape).join("|")})(?![A-Z0-9])`)
    : null,
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
      (rule.bankCategory && hints.bankCategory && rule.bankCategory.includes(hints.bankCategory));
    if (matched) return categoryOf(rule.category);
  }
  return null;
}
