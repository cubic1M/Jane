import { describe, expect, it } from "vitest";
import type { InsightTransaction } from "@/insights/spending";
import { parseIntent } from "./intents";
import { spendingReply } from "./replies";

// Debug 2, fourth desktop sweep (11-17, upload S6: 14 months of statements): "how much do I spend
// on Netflix a month?" answered "You spend about $15.49 a month at Netflix, from December to
// October", meaning December 2025 to October 2026. Months that cross a year say their years.

const TODAY = "2026-11-17";
const netflix = (date: string): InsightTransaction => ({
  date,
  amountCents: 1_549,
  description: "Netflix",
  merchantName: "Netflix",
  pfcPrimary: "ENTERTAINMENT",
  pfcDetailed: null,
  pending: false,
});
const months = [
  "2025-09-21",
  "2025-10-21",
  "2025-11-21",
  "2025-12-21",
  "2026-01-21",
  "2026-02-21",
  "2026-03-21",
  "2026-04-21",
  "2026-05-21",
  "2026-06-21",
  "2026-07-21",
  "2026-08-21",
  "2026-09-21",
  "2026-10-21",
  "2026-11-14",
];

const answer = (text: string, rows: InsightTransaction[]) => {
  const intent = parseIntent(text, TODAY);
  if (intent.kind !== "spending") throw new Error(intent.kind);
  return spendingReply(intent, rows, TODAY).body;
};

describe("a usual month over months that cross a year", () => {
  it("says the years", () => {
    expect(answer("how much do I spend on netflix a month?", months.map(netflix))).toBe(
      "You spend about $15.49 a month at Netflix, from December 2025 to October 2026.",
    );
  });

  it("leaves them out within one year", () => {
    expect(answer("how much do I spend on netflix a month?", months.slice(10).map(netflix))).toBe(
      "You spend about $15.49 a month at Netflix, from August to October.",
    );
  });
});
