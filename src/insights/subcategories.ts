import { kindOf, type InsightTransaction } from "./spending";

// The parts of a category people ask about by name: "groceries" isn't all of Food and drink, and
// "gas" isn't all of Transportation (night round 11-06: "how much did I spend on groceries" was
// answered with Food and drink, restaurants and coffee included). Plaid's detailed categories.
export type Subcategory = { name: string; words: readonly string[]; detailed: readonly string[] };

export const SUBCATEGORIES: readonly Subcategory[] = [
  { name: "groceries", words: ["groceries", "grocery"], detailed: ["FOOD_AND_DRINK_GROCERIES"] },
  { name: "coffee", words: ["coffee"], detailed: ["FOOD_AND_DRINK_COFFEE"] },
  {
    name: "eating out",
    words: [
      "eating out",
      "restaurants",
      "restaurant",
      "dining",
      "dining out",
      "takeout",
      "take out",
    ],
    detailed: ["FOOD_AND_DRINK_RESTAURANT", "FOOD_AND_DRINK_FAST_FOOD"],
  },
  {
    name: "drinks",
    words: ["drinks", "bars", "alcohol"],
    detailed: ["FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR"],
  },
  { name: "gas", words: ["gas", "fuel"], detailed: ["TRANSPORTATION_GAS"] },
  { name: "parking", words: ["parking"], detailed: ["TRANSPORTATION_PARKING"] },
  {
    name: "rides",
    words: ["rides", "taxis", "ride shares", "rideshare"],
    detailed: ["TRANSPORTATION_TAXIS_AND_RIDE_SHARES"],
  },
  { name: "transit", words: ["transit", "commute"], detailed: ["TRANSPORTATION_PUBLIC_TRANSIT"] },
  { name: "rent", words: ["rent"], detailed: ["RENT_AND_UTILITIES_RENT"] },
  {
    name: "utilities",
    words: ["utilities", "electric", "electricity", "water"],
    detailed: [
      "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
      "RENT_AND_UTILITIES_WATER",
      "RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT",
      "RENT_AND_UTILITIES_OTHER_UTILITIES",
    ],
  },
];

export function matchSubcategory(query: string): Subcategory | null {
  const q = query.trim().toLowerCase();
  return SUBCATEGORIES.find((s) => s.words.includes(q)) ?? null;
}

// The category a part belongs to: every one of its detailed names starts with it.
const PRIMARIES = ["FOOD_AND_DRINK", "TRANSPORTATION", "RENT_AND_UTILITIES"] as const;
export const primaryOf = (sub: Subcategory) =>
  PRIMARIES.find((p) => sub.detailed[0].startsWith(`${p}_`))!;

// What went to one part in a month, refunds netted, never below $0. Null when none of the
// month's spending in that category says which part it is (a statement read by category alone):
// then $0 would be a guess.
export function subcategorySpending(
  transactions: readonly InsightTransaction[],
  month: string,
  sub: Subcategory,
): number | null {
  const primary = primaryOf(sub);
  const inCategory = transactions.filter(
    (t) => t.date.startsWith(month) && kindOf(t) === "spending" && t.pfcPrimary === primary,
  );
  if (!inCategory.some((t) => t.pfcDetailed?.startsWith(`${primary}_`))) return null;
  const cents = inCategory
    .filter((t) => t.pfcDetailed !== null && sub.detailed.includes(t.pfcDetailed))
    .reduce((sum, t) => sum + t.amountCents, 0);
  return Math.max(0, cents);
}
