import { describe, expect, it } from "vitest";
import type { InsightTransaction } from "@/insights/spending";
import { parseIntent } from "./intents";
import { spendingReply } from "./replies";

// Debugger 11-17 (r323, 14 months of Wells Fargo checking, chat on a phone): "how much do I spend
// on gas a month?" answered "You spent $52.78 on gas in November 2026 so far. In all of October it
// was $273.83." A part of a category ("gas", "groceries") gets a usual month too, as a merchant or
// a whole category does (#1995).

const TODAY = "2026-11-17";
const t = (date: string, cents: number, merchant: string, detailed: string) =>
  ({
    date,
    amountCents: cents,
    description: merchant,
    merchantName: merchant,
    pfcPrimary: detailed.startsWith("TRANSPORTATION") ? "TRANSPORTATION" : "FOOD_AND_DRINK",
    pfcDetailed: detailed,
    pending: false,
  }) satisfies InsightTransaction;
const rows = [
  t("2026-09-02", 5_000, "Shell", "TRANSPORTATION_GAS"),
  t("2026-09-20", 4_000, "Shell", "TRANSPORTATION_GAS"),
  t("2026-09-21", 2_500, "Bart", "TRANSPORTATION_PUBLIC_TRANSIT"),
  t("2026-10-07", 6_000, "Chevron", "TRANSPORTATION_GAS"),
  t("2026-10-21", 1_500, "Bart", "TRANSPORTATION_PUBLIC_TRANSIT"),
  t("2026-11-07", 5_278, "Shell", "TRANSPORTATION_GAS"),
];

describe("what someone spends on a part of a category a month", () => {
  it("is the part's usual month, from the full months", () => {
    const intent = parseIntent("how much do I spend on gas a month?", TODAY);
    if (intent.kind !== "spending") throw new Error(intent.kind);
    expect(spendingReply(intent, rows, TODAY).body).toBe(
      "You spend about $75.00 a month on gas, from September and October.",
    );
  });
});
