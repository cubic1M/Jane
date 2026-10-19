import type { PfcDetailed, PfcPrimary } from "@/categorize/taxonomy";

// The right card for each purchase (spec step 174): the kinds of spending card rewards are
// paid on, which of the person's own spending counts, and when Jane brings a card up.

export const REWARD_CATEGORIES = [
  "dining",
  "groceries",
  "gas",
  "travel",
  "streaming",
  "online",
  "other",
] as const;
export type RewardCategory = (typeof REWARD_CATEGORIES)[number];

export const REWARD_CATEGORY_LABELS: Record<RewardCategory, string> = {
  dining: "Dining and coffee",
  groceries: "Groceries",
  gas: "Gas",
  travel: "Travel and rides",
  streaming: "Streaming",
  online: "Online shopping",
  other: "Everything else",
};

// Plaid categories (detailed first, then primary) to the kind of spending a card pays on.
// Anything not listed is "other".
export const REWARD_CATEGORY_OF_DETAILED: Partial<Record<PfcDetailed, RewardCategory>> = {
  FOOD_AND_DRINK_GROCERIES: "groceries",
  TRANSPORTATION_GAS: "gas",
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES: "travel",
  TRANSPORTATION_PUBLIC_TRANSIT: "travel",
  TRANSPORTATION_PARKING: "travel",
  TRANSPORTATION_TOLLS: "travel",
  ENTERTAINMENT_TV_AND_MOVIES: "streaming",
  ENTERTAINMENT_MUSIC_AND_AUDIO: "streaming",
  GENERAL_MERCHANDISE_ONLINE_MARKETPLACES: "online",
};
export const REWARD_CATEGORY_OF_PRIMARY: Partial<Record<PfcPrimary, RewardCategory>> = {
  FOOD_AND_DRINK: "dining",
  TRAVEL: "travel",
};

// Spending a card can't earn on (or that is rarely put on one): fees, loan and rent
// payments, taxes, and money between the person's own accounts.
export const NOT_CARD_SPENDING_PRIMARIES: readonly PfcPrimary[] = [
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_DISBURSEMENTS",
  "LOAN_PAYMENTS",
  "BANK_FEES",
];
export const NOT_CARD_SPENDING_DETAILED: readonly PfcDetailed[] = [
  "RENT_AND_UTILITIES_RENT",
  "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
];

// A year of the person's own spending, so rewards and fees compare over the same year.
export const CARD_SPEND_DAYS = 365;
// History at least this long counts as the full year; shorter is scaled up to a year.
export const CARD_SPEND_FULL_DAYS = 335;
// Less history than this and Jane says the figures are a first look.
export const CARD_SPEND_MIN_DAYS = 60;

// A point or mile, valued as cash back: the stand-in catalog states each card's value.
// A new card is only brought up when it adds at least this much a year after its fee.
export const CARD_BETTER_MIN_CENTS = 5_000;
// Partners that can show a card catalog; the demo stand-in only for the demo bank.
export const CARD_PARTNER = "demo";
// The demo stand-in's decision on an application (spec step 174).
export const DEMO_CARD_ARRIVES = "7–10 days";
