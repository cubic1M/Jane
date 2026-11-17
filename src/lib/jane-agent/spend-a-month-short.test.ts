import { describe, expect, it } from "vitest";
import type { InsightTransaction } from "@/insights/spending";
import { parseIntent } from "./intents";
import { spendingReply } from "./replies";

// Debugger 11-17 (r324, one month of Chase checking, Oct 15 to Nov 14, chat on a phone): "how much
// do I spend on groceries a month?" answered "You spent $79.82 on groceries in November 2026 so
// far": fourteen days, read as a month. With no full month on file, the answer says so and gives
// what the days it has hold.

const TODAY = "2026-11-17";
const t = (date: string, cents: number, merchant: string, detailed: string) =>
  ({
    date,
    amountCents: cents,
    description: merchant,
    merchantName: merchant,
    pfcPrimary: "FOOD_AND_DRINK",
    pfcDetailed: detailed,
    pending: false,
  }) satisfies InsightTransaction;
const rows = [
  t("2026-10-15", 4_210, "Safeway", "FOOD_AND_DRINK_GROCERIES"),
  t("2026-10-24", 3_105, "Safeway", "FOOD_AND_DRINK_GROCERIES"),
  t("2026-10-30", 1_295, "Chipotle", "FOOD_AND_DRINK_FAST_FOOD"),
  t("2026-11-07", 2_954, "Safeway", "FOOD_AND_DRINK_GROCERIES"),
  t("2026-11-14", 3_388, "Safeway", "FOOD_AND_DRINK_GROCERIES"),
];
const answer = (text: string) => {
  const intent = parseIntent(text, TODAY);
  if (intent.kind !== "spending") throw new Error(intent.kind);
  return spendingReply(intent, rows, TODAY).body;
};

describe("a usual month with less than a month on file", () => {
  it("says there's no full month, and what the days hold", () => {
    expect(answer("how much do I spend on groceries a month?")).toBe(
      "I don't have a full month yet, just 31 days (Oct 15 to Nov 14): you spent $136.57 on groceries in that time.",
    );
  });

  it("does the same for a merchant", () => {
    expect(answer("how much do i spend at safeway a month")).toBe(
      "I don't have a full month yet, just 31 days (Oct 15 to Nov 14): you spent $136.57 at Safeway in that time.",
    );
  });
});
