import { describe, expect, it } from "vitest";
import type { InsightTransaction } from "@/insights/spending";
import { parseIntent } from "./intents";
import { spendingReply } from "./replies";

// Walk notes, phone passes 5 to 7 and desktop sweeps 7 to 9: asked with no period, "how much have I
// spent on Uber?", "how much do I spend at Coupa Cafe?" and "how much do I spend at Whole Foods a
// month?" all got this month so far ("You spent $14.20 at Uber in November 2026 so far" for $95.80
// since Aug 28). Everything on file, and a usual month, are the answers; a two-word merchant is found.

const TODAY = "2026-11-20";
const t = (date: string, cents: number, merchant: string, detailed: string) =>
  ({
    date,
    amountCents: cents,
    description: merchant,
    merchantName: merchant,
    pfcPrimary: detailed.split("_").slice(0, 2).join("_"),
    pfcDetailed: detailed,
    pending: false,
  }) satisfies InsightTransaction;
const ask = (question: string, rows: InsightTransaction[]) => {
  const intent = parseIntent(question, TODAY);
  if (intent.kind !== "spending") throw new Error(intent.kind);
  return spendingReply(intent, rows, TODAY).body;
};

const uber = [
  t("2026-08-28", 1_820, "Uber", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"),
  t("2026-09-12", 1_650, "Uber", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"),
  t("2026-09-30", 1_500, "Uber", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"),
  t("2026-10-09", 1_740, "Uber", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"),
  t("2026-10-25", 1_450, "Uber", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"),
  t("2026-11-04", 1_420, "Uber", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"),
];
const wholeFoods = ["2026-08", "2026-09", "2026-10"].flatMap((m) => [
  t(`${m}-03`, 8_000, "Whole Foods", "FOOD_AND_DRINK_GROCERIES"),
  t(`${m}-17`, 9_150, "Whole Foods", "FOOD_AND_DRINK_GROCERIES"),
]);

describe("spending asked with no period", () => {
  it("is everything on file, and this month's part (Uber, Plaid S2)", () => {
    expect(ask("How much have I spent on Uber?", uber)).toBe(
      "You've spent $95.80 at Uber since Aug 28 (6 times), $14.20 of it in November so far.",
    );
  });

  it("finds a two-word merchant's usual month (Whole Foods, Plaid S6)", () => {
    expect(ask("How much do I spend at Whole Foods a month?", wholeFoods)).toBe(
      "You spend about $171.50 a month at Whole Foods, from August and September.",
    );
  });

  it("reads 'how much do I spend' as a usual month", () => {
    expect(ask("how much do I spend on Uber", uber)).toMatch(
      /^You spend about \$31\.70 a month at Uber, from September and October\.$/,
    );
  });

  it("keeps a month asked for, and a whole category's month", () => {
    expect(ask("how much did I spend at Uber last month", uber)).toMatch(
      /^You spent \$31\.90 at Uber in October 2026/,
    );
    expect(parseIntent("how much did I spend on food", TODAY)).toMatchObject({
      kind: "spending",
      sinceStart: true,
    });
    const lunch = t("2026-11-06", 1_250, "Chipotle", "FOOD_AND_DRINK_RESTAURANT");
    expect(ask("how much did I spend on food", [...uber, lunch])).toMatch(
      /in November 2026 so far/,
    );
  });
});
