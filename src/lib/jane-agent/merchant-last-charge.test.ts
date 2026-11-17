import { describe, expect, it } from "vitest";
import type { InsightTransaction } from "@/insights/spending";
import { spendingReply } from "./replies";

// Debugger 11-17 (Plaid sandbox, one month, phone): "how much is Hulu right now?" read "I couldn't
// find spending on "hulu" in November 2026 so far. The most went to: …", though Hulu was $9.99 on
// Oct 20. Nothing there this month isn't nothing there at all.

const TODAY = "2026-11-16";
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
  t("2026-10-18", 6_100, "Trader Joe's", "FOOD_AND_DRINK"),
  t("2026-10-20", 999, "Hulu", "ENTERTAINMENT"),
  t("2026-11-01", 70_000, "Maya Chen", "RENT_AND_UTILITIES"),
  t("2026-11-08", 6_100, "Trader Joe's", "FOOD_AND_DRINK"),
];
const ask = (category: string) =>
  spendingReply({ kind: "spending", category, month: "2026-11" }, rows, TODAY).body;

describe("a merchant with nothing this month", () => {
  it("says so, and when and how much it was last", () => {
    expect(ask("hulu")).toBe(
      "Nothing at Hulu in November 2026 so far. The last was $9.99 on Oct 20.",
    );
  });

  it("a name that's nowhere is still not found", () => {
    expect(ask("zorblax")).toMatch(/^I couldn't find spending on "zorblax"/);
  });
});
