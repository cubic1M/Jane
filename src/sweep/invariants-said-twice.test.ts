import { describe, expect, it } from "vitest";
import { saidTwice } from "./invariants";

// The said-twice rule (class 7, debug3-invariants.md).

const one = (text: string) => saidTwice({ "suggestions.x.why": text });

describe("a figure said twice in one sentence", () => {
  it("is caught when a clause only says it again", () => {
    expect(
      one("Masterclass started with a trial and now costs $120.00 (charged once): $120.00."),
    ).toHaveLength(1);
    expect(
      one(
        "I see no policy. A benefit of $3,050.10 a month, after a 90-day wait, until 65: $3,050.10 a month short.",
      ),
    ).toHaveLength(1);
  });

  it("is let be when the same figure means two things", () => {
    for (const text of [
      "Your net worth is $8,450.00: you have $8,450.00, and I don't see any debts.",
      "Injury liability of $100,000.00 per person; yours is $50,000.00 and $100,000.00.",
      "Next about Nov 12, around $578.39. By now, $578.39 of it set aside.",
      "Two trials now cost $25.00 and $30.00: $55.00 a year in all.",
    ]) {
      expect(one(text), text).toEqual([]);
    }
  });
});
