import { describe, expect, it } from "vitest";
import type { InsightTransaction } from "@/insights/spending";
import { parseIntent } from "./intents";
import { spendingReply } from "./replies";

// Debugger 11-17 (r322, a Bank of America checking and a Chase card upload, chat on a phone): "how
// much do I spend on amazon a month?" answered "I couldn't find spending on "amazon a month" in
// November 2026 so far." "A month" is how often, not part of the name, and the answer is a usual
// month: the full months the data covers, on average.

const TODAY = "2026-11-17";
const t = (date: string, cents: number, merchant: string, pfcPrimary: string) =>
  ({
    date,
    amountCents: cents,
    description: merchant,
    merchantName: merchant,
    pfcPrimary,
    pfcDetailed: null,
    pending: false,
  }) satisfies InsightTransaction;
const rows = [
  // August starts on the 19th: not a full month.
  t("2026-08-19", 1_915, "Amazon", "GENERAL_MERCHANDISE"),
  t("2026-09-05", 6_144, "Amazon", "GENERAL_MERCHANDISE"),
  t("2026-09-20", 4_000, "Amazon", "GENERAL_MERCHANDISE"),
  t("2026-09-21", 3_954, "Doordash", "FOOD_AND_DRINK"),
  t("2026-10-06", 2_973, "Amazon", "GENERAL_MERCHANDISE"),
  t("2026-10-25", 5_267, "Amazon", "GENERAL_MERCHANDISE"),
  t("2026-10-26", 3_479, "Doordash", "FOOD_AND_DRINK"),
  t("2026-11-04", 3_083, "Amazon", "GENERAL_MERCHANDISE"),
  t("2026-11-14", 3_860, "Doordash", "FOOD_AND_DRINK"),
];
const answer = (text: string) => {
  const intent = parseIntent(text, TODAY);
  if (intent.kind !== "spending") throw new Error(intent.kind);
  return spendingReply(intent, rows, TODAY).body;
};

describe("what someone spends somewhere a month", () => {
  it("reads the place without the pace", () => {
    expect(parseIntent("how much do I spend on amazon a month?", TODAY)).toMatchObject({
      kind: "spending",
      category: "amazon",
      perMonth: true,
    });
    expect(parseIntent("how much do i spend on amazon each month", TODAY)).toMatchObject({
      category: "amazon",
      perMonth: true,
    });
  });

  it("is a merchant's usual month, from the full months", () => {
    expect(answer("how much do I spend on amazon a month?")).toBe(
      "You spend about $91.92 a month at Amazon, from September and October.",
    );
  });

  it("is a category's usual month too", () => {
    expect(answer("how much do i spend on food a month")).toBe(
      "You spend about $37.17 a month on Food and drink, from September and October.",
    );
  });

  it("leaves this month's question alone", () => {
    expect(answer("how much did I spend on amazon this month")).toBe(
      "You spent $30.83 at Amazon in November 2026 so far.",
    );
  });
});
