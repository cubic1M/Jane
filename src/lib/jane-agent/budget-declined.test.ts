import { describe, expect, it } from "vitest";
import { spendingReply } from "./replies";

// Debug 2 re-walk (11-16, upload S1, 1280 light): No on the dock's "I could set a $160.00 monthly
// budget for Food and drink", then "how much did I spend on food last month?" a minute later
// answered "A $160.00 budget would match a usual month." with "Set a $160.00 budget". A budget
// turned down isn't offered again in the chat.

const food = (date: string, cents: number) => ({
  date,
  amountCents: cents,
  description: "TACO BELL 031 TUCSON AZ",
  merchantName: null,
  pfcPrimary: "FOOD_AND_DRINK",
  pfcDetailed: "FOOD_AND_DRINK_FAST_FOOD",
  pending: false,
});
const rows = [
  food("2026-08-19", 1_116),
  food("2026-09-09", 13_019),
  food("2026-10-06", 18_866),
  food("2026-11-07", 3_085),
];
const AS_OF = "2026-11-16";
const ask = { kind: "spending" as const, category: "food", month: "2026-10" };

describe("a budget the person turned down", () => {
  it("isn't offered again when they ask about the category", () => {
    const reply = spendingReply(ask, rows, AS_OF, [], { declined: ["Food and drink"] });
    expect(reply.body).toBe(
      "You spent $188.66 on Food and drink in October 2026. That's $58.47 more than in September.",
    );
    expect(reply.actions.map((a) => a.label)).toEqual(["See insights"]);
  });

  it("is still offered for a category they haven't answered", () => {
    const reply = spendingReply(ask, rows, AS_OF, [], { declined: ["Entertainment"] });
    expect(reply.body).toContain("A $160.00 budget would match a usual month.");
  });
});
