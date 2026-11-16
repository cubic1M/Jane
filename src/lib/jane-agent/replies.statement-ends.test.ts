import { describe, expect, it } from "vitest";
import type { InsightTransaction } from "@/insights/spending";
import { parseIntent, type Intent } from "./intents";
import { spendingReply } from "./replies";

// Gate E (11-16): a beta person whose only upload is October's statement asks on Nov 3. The month
// they're in has nothing in it yet, and that isn't nothing spent.
const TODAY = "2026-11-03";

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
  t("2026-10-01", 120_000, "RENT_AND_UTILITIES", "Avalon Property"),
  t("2026-10-02", 6_420, "FOOD_AND_DRINK", "Trader Joe's"),
  t("2026-10-14", 2_840, "FOOD_AND_DRINK", "DoorDash"),
  t("2026-10-31", 3_860, "TRANSPORTATION", "Shell"),
];

describe("this month before anything from it has come in", () => {
  it("says where the statement ends, then answers from the month it has", () => {
    expect(spendingReply(spending("what did I spend on food"), october, TODAY).body).toBe(
      "I don't see anything from November 2026 yet: what I have ends on Oct 31. You spent $92.60 on Food and drink in October 2026.",
    );
    expect(spendingReply(spending("how much have I spent this month"), october, TODAY).body).toBe(
      "I don't see anything from November 2026 yet: what I have ends on Oct 31. You spent $1,331.20 in October 2026. The most went to: Rent and utilities $1,200.00, Food and drink $92.60, Transportation $38.60.",
    );
  });

  it("never says $0.00 so far for a month with nothing in it", () => {
    for (const text of [
      "what did I spend on food",
      "spending this month",
      "how much did I spend at DoorDash",
    ]) {
      expect(spendingReply(spending(text), october, TODAY).body).not.toMatch(/\$0\.00|so far/);
    }
  });

  it("still says so far once the month has something in it", () => {
    const withNovember = [...october, t("2026-11-02", 1_500, "FOOD_AND_DRINK", "Chipotle")];
    expect(spendingReply(spending("what did I spend on food"), withNovember, TODAY).body).toBe(
      "You spent $15.00 on Food and drink in November 2026 so far. In all of October it was $92.60.",
    );
  });
});
