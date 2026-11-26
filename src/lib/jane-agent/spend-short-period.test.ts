import { describe, expect, it } from "vitest";
import type { InsightTransaction } from "@/insights/spending";
import { parseIntent } from "./intents";
import { spendingReply } from "./replies";

// CodeRabbit part 2 (open O24): "how much have I spent on groceries this week?" is the last seven
// days, not the month so far; "today" and "yesterday" are those days.

const TODAY = "2026-11-17";
const t = (
  date: string,
  cents: number,
  merchant: string,
  pfcPrimary: string,
  pfcDetailed: string | null = null,
) =>
  ({
    date,
    amountCents: cents,
    description: merchant,
    merchantName: merchant,
    pfcPrimary,
    pfcDetailed,
    pending: false,
  }) satisfies InsightTransaction;
const rows = [
  t("2026-11-02", 9_000, "Safeway", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
  t("2026-11-09", 5_000, "Safeway", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
  t("2026-11-12", 2_500, "Trader Joes", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
  t("2026-11-15", 3_000, "Safeway", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
  t("2026-11-16", 1_200, "Chipotle", "FOOD_AND_DRINK", "FOOD_AND_DRINK_FAST_FOOD"),
  t("2026-11-17", 800, "Peets", "FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE"),
  t("2026-10-20", 4_000, "Safeway", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
];
const answer = (text: string) => {
  const intent = parseIntent(text, TODAY);
  if (intent.kind !== "spending") throw new Error(intent.kind);
  return spendingReply(intent, rows, TODAY).body;
};

describe("spending for a day or a week", () => {
  it("reads the span asked for", () => {
    expect(parseIntent("how much have I spent on groceries this week", TODAY)).toMatchObject({
      shortPeriod: "week",
    });
    expect(parseIntent("what did I spend yesterday", TODAY)).toMatchObject({
      shortPeriod: "yesterday",
    });
    expect(parseIntent("what did I spend today", TODAY)).toMatchObject({ shortPeriod: "today" });
    expect(parseIntent("how much did I spend on food last week", TODAY)).toMatchObject({
      shortPeriod: "last_week",
    });
  });

  it("answers the last seven days, not the month so far", () => {
    // Nov 11 to Nov 17: Trader Joes 2500 and Safeway 3000 on the 15th.
    expect(answer("how much have I spent on groceries this week")).toBe(
      "You spent $55.00 on groceries in the last 7 days (Nov 11 to Nov 17).",
    );
  });

  it("answers a merchant's week, and all spending's", () => {
    expect(answer("how much have I spent at Safeway this week")).toBe(
      "You spent $30.00 at Safeway in the last 7 days (Nov 11 to Nov 17).",
    );
    expect(answer("how much did I spend this week")).toMatch(
      /^You spent \$75\.00 in the last 7 days/,
    );
  });

  it("answers today and yesterday by their own day", () => {
    expect(answer("how much did I spend today")).toBe("You spent $8.00 today.");
    expect(answer("how much did I spend yesterday")).toBe("You spent $12.00 yesterday.");
  });

  it("answers the week before", () => {
    // Nov 4 to Nov 10: the Nov 9 Safeway.
    expect(answer("how much did I spend on groceries last week")).toBe(
      "You spent $50.00 on groceries last week (Nov 4 to Nov 10).",
    );
  });

  // The days count back from the person's own today, across a month and a year turn.
  it("crosses a month turn and a year turn", () => {
    const turn = [
      t("2026-12-30", 1_000, "Safeway", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
      t("2026-12-31", 2_000, "Safeway", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
      t("2027-01-01", 4_000, "Safeway", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
      t("2027-01-02", 8_000, "Safeway", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
    ];
    const at = (today: string, text: string) => {
      const intent = parseIntent(text, today);
      if (intent.kind !== "spending") throw new Error(intent.kind);
      return spendingReply(intent, turn, today).body;
    };
    expect(at("2027-01-02", "how much did I spend this week")).toMatch(
      /^You spent \$150\.00 in the last 7 days \(Dec 27 to Jan 2\)/,
    );
    expect(at("2027-01-02", "how much did I spend yesterday")).toBe("You spent $40.00 yesterday.");
    expect(at("2027-01-06", "how much did I spend last week")).toBe(
      "You spent $10.00 last week (Dec 24 to Dec 30). What I have starts on Dec 30.",
    );
    expect(at("2026-12-31", "how much did I spend yesterday")).toBe("You spent $10.00 yesterday.");
  });

  // CodeRabbit #2290: the period word ends the merchant's name.
  it("reads a merchant named before the period word", () => {
    expect(parseIntent("how much did I spend at Safeway yesterday", TODAY)).toMatchObject({
      category: "safeway",
      shortPeriod: "yesterday",
    });
    expect(parseIntent("how much did I spend on groceries past week", TODAY)).toMatchObject({
      category: "groceries",
      shortPeriod: "week",
    });
    expect(parseIntent("how much did I spend at Safeway today", TODAY)).toMatchObject({
      category: "safeway",
      shortPeriod: "today",
    });
  });

  it("says where what it has starts, too", () => {
    const recent = rows.filter((r) => r.date >= "2026-11-15");
    const intent = parseIntent("how much did I spend this week", TODAY);
    if (intent.kind !== "spending") throw new Error("kind");
    expect(spendingReply(intent, recent, TODAY).body).toMatch(
      /^You spent \$50\.00 in the last 7 days .*What I have starts on Nov 15\.$/,
    );
    const yesterday = parseIntent("how much did I spend yesterday", TODAY);
    if (yesterday.kind !== "spending") throw new Error("kind");
    const today = recent.filter((r) => r.date === TODAY);
    expect(spendingReply(yesterday, today, TODAY).body).toBe(
      "I can't see yesterday: what I have starts on Nov 17.",
    );
  });

  // One rule for every answer: the days' total, refunds netting against purchases, never below zero.
  it("nets a refund against a purchase across the days, the same for all spending and a merchant", () => {
    const refunds = [
      t("2026-12-31", 10_000, "Safeway", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
      t("2027-01-01", -10_000, "Safeway", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
      t("2027-01-02", 2_000, "Peets", "FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE"),
    ];
    const at = (text: string) => {
      const intent = parseIntent(text, "2027-01-02");
      if (intent.kind !== "spending") throw new Error(intent.kind);
      return spendingReply(intent, refunds, "2027-01-02").body;
    };
    expect(at("how much did I spend this week")).toMatch(/^You spent \$20\.00 in the last 7 days/);
    expect(at("how much did I spend at Safeway this week")).toMatch(
      /^You spent \$0\.00 at Safeway in the last 7 days/,
    );
  });

  it("reads a part whose spending sits in one month of the days", () => {
    const apart = [
      t("2026-12-31", 6_000, "Safeway", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
      t("2027-01-01", 1_000, "Peets", "FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE"),
    ];
    const intent = parseIntent("how much did I spend on groceries this week", "2027-01-01");
    if (intent.kind !== "spending") throw new Error(intent.kind);
    expect(spendingReply(intent, apart, "2027-01-01").body).toMatch(
      /^You spent \$60\.00 on groceries in the last 7 days/,
    );
  });

  it("says when what it has ends before the days do", () => {
    const old = rows.filter((r) => r.date <= "2026-11-12");
    const intent = parseIntent("how much did I spend this week", TODAY);
    if (intent.kind !== "spending") throw new Error("kind");
    expect(spendingReply(intent, old, TODAY).body).toMatch(/What I have ends on Nov 12\.$/);
    const stale = rows.filter((r) => r.date <= "2026-11-01");
    expect(spendingReply(intent, stale, TODAY).body).toMatch(
      /^I can't see the last 7 days \(Nov \d+ to Nov \d+\): what I have ends on Oct 20\.$/,
    );
  });
});
