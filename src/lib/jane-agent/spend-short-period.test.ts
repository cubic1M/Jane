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
      "You spent $10.00 last week (Dec 24 to Dec 30).",
    );
    expect(at("2026-12-31", "how much did I spend yesterday")).toBe("You spent $10.00 yesterday.");
  });

  it("says when what it has ends before the days do", () => {
    const old = rows.filter((r) => r.date <= "2026-11-12");
    const intent = parseIntent("how much did I spend this week", TODAY);
    if (intent.kind !== "spending") throw new Error("kind");
    expect(spendingReply(intent, old, TODAY).body).toMatch(/What I have ends on Nov 12\.$/);
    const stale = rows.filter((r) => r.date <= "2026-11-01");
    expect(spendingReply(intent, stale, TODAY).body).toMatch(/can't see .*what I have ends on/);
  });
});
