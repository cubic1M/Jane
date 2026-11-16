import { describe, expect, it } from "vitest";
import type { InsightTransaction } from "@/insights/spending";
import { parseIntent, type Intent } from "./intents";
import { spendingReply } from "./replies";

// Debugger 11-16 (a student linked through Plaid sandbox): "how much did I spend on food last
// month?" answered "You spent $40.00 at Food S in October 2026", a school lunch account whose
// name has the word in it, instead of the month's food. A word that names a category is the
// category; a merchant still wins when the word is its whole name, or names no category.
const TODAY = "2026-11-15";

const spending = (text: string) => {
  const parsed = parseIntent(text, TODAY);
  if (parsed.kind !== "spending") throw new Error(`"${text}" parsed as ${parsed.kind}`);
  return parsed as Extract<Intent, { kind: "spending" }>;
};
const t = (date: string, cents: number, pfcPrimary: string, merchant: string) =>
  ({
    date,
    amountCents: cents,
    description: merchant,
    merchantName: merchant,
    pfcPrimary,
    pfcDetailed: null,
    pending: false,
  }) satisfies InsightTransaction;
const october = [
  t("2026-10-05", 6_663, "FOOD_AND_DRINK", "McDonald's"),
  t("2026-10-12", 4_547, "FOOD_AND_DRINK", "Starbucks"),
  t("2026-10-26", 2_000, "GOVERNMENT_AND_NON_PROFIT", "Food S"),
  t("2026-10-28", 2_000, "GOVERNMENT_AND_NON_PROFIT", "Food S"),
  t("2026-10-20", 5_234, "TRANSPORTATION", "Uber"),
];

describe("a category's word in a merchant's name", () => {
  it("answers with the category", () => {
    expect(
      spendingReply(spending("how much did I spend on food last month?"), october, TODAY).body,
    ).toMatch(/^You spent \$112\.10 on Food and drink in October 2026\./);
  });

  it("still finds a merchant by its name", () => {
    expect(
      spendingReply(spending("how much did I spend at Uber last month?"), october, TODAY).body,
    ).toBe("You spent $52.34 at Uber in October 2026.");
  });
});
