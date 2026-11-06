import { describe, expect, it } from "vitest";
import { spendingReply } from "@/lib/jane-agent/replies";
import type { InsightTransaction } from "./spending";
import { matchSubcategory, subcategorySpending } from "./subcategories";

// Night round 11-06: "how much did i spend on groceries last month" was answered with all of Food
// and drink, restaurants and coffee included.
const t = (
  date: string,
  amountCents: number,
  pfcDetailed: string | null,
  merchantName: string,
): InsightTransaction => ({
  date,
  amountCents,
  description: merchantName,
  merchantName,
  pfcPrimary: pfcDetailed
    ? pfcDetailed.replace(/_(GROCERIES|RESTAURANT|COFFEE|GAS|PARKING|RENT)$/, "")
    : "FOOD_AND_DRINK",
  pfcDetailed,
  pending: false,
});
const DATA = [
  t("2026-09-04", 20_000, "FOOD_AND_DRINK_GROCERIES", "Fern Market"),
  t("2026-09-12", 9_000, "FOOD_AND_DRINK_RESTAURANT", "Larkspur Bistro"),
  t("2026-10-03", 25_000, "FOOD_AND_DRINK_GROCERIES", "Fern Market"),
  t("2026-10-09", -1_000, "FOOD_AND_DRINK_GROCERIES", "Fern Market"),
  t("2026-10-10", 12_000, "FOOD_AND_DRINK_RESTAURANT", "Larkspur Bistro"),
  t("2026-10-11", 600, "FOOD_AND_DRINK_COFFEE", "Pine Cup"),
  t("2026-10-15", 4_000, "TRANSPORTATION_GAS", "Ridge Fuel"),
  t("2026-10-16", 1_500, "TRANSPORTATION_PARKING", "City Lot"),
];

describe("the parts of a category asked for by name", () => {
  it("knows the everyday words", () => {
    expect(matchSubcategory("Groceries")?.name).toBe("groceries");
    expect(matchSubcategory("dining out")?.name).toBe("eating out");
    expect(matchSubcategory("fuel")?.name).toBe("gas");
    expect(matchSubcategory("food")).toBeNull();
  });

  it("adds up one part, refunds netted", () => {
    expect(subcategorySpending(DATA, "2026-10", matchSubcategory("groceries")!)).toBe(24_000);
    expect(subcategorySpending(DATA, "2026-10", matchSubcategory("gas")!)).toBe(4_000);
  });

  it("doesn't guess $0 when no charge says which part it is", () => {
    const byCategoryOnly = DATA.map((x) => ({ ...x, pfcDetailed: null }));
    expect(
      subcategorySpending(byCategoryOnly, "2026-10", matchSubcategory("groceries")!),
    ).toBeNull();
    expect(subcategorySpending(DATA, "2026-08", matchSubcategory("groceries")!)).toBeNull();
  });

  it("answers groceries with groceries, and the whole category beside it", () => {
    const reply = spendingReply(
      { kind: "spending", category: "groceries", month: "2026-10" },
      DATA,
      "2026-11-05",
    );
    expect(reply.body).toBe(
      "You spent $240.00 on groceries in October 2026, of $366.00 on Food and drink in all. That's $40.00 more than in September.",
    );
  });

  it("keeps the whole category when the data can't split it", () => {
    const reply = spendingReply(
      { kind: "spending", category: "groceries", month: "2026-10" },
      DATA.map((x) => ({ ...x, pfcDetailed: null })),
      "2026-11-05",
    );
    expect(reply.body).toMatch(/^You spent \$366\.00 on Food and drink in October 2026\./);
  });
});

describe("a spending word straight after spend", () => {
  it("is the category when it names one, and the whole month when it doesn't", async () => {
    const { parseIntent } = await import("@/lib/jane-agent/intents");
    expect(parseIntent("how much did i spend eating out last month", "2026-11-05")).toMatchObject({
      kind: "spending",
      category: "eating out",
      month: "2026-10",
    });
    expect(parseIntent("what did i spend last month", "2026-11-05")).toMatchObject({
      kind: "spending",
      category: null,
      month: "2026-10",
    });
  });
});
