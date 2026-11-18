import { describe, expect, it } from "vitest";
import { DIY_KITS } from "@/config/diy";
import { templateExplanation } from "./explain-templates";

// Debugger 11-18 (r341, Plaid S6 on a phone): the card-interest page said "What you'd do: You ask
// your card company for a lower rate", then listed "Ask your card issuer for a lower rate" under
// "Other options". The other options are other ways, never the step the card already gives.

describe("a card charging interest", () => {
  it("doesn't offer its own step again as another option", () => {
    expect(DIY_KITS.card_interest?.summary).toMatch(/lower rate/);
    const { alternatives } = templateExplanation("$371.00 in interest", {
      findingType: "card_interest",
      savingsPerYear: "$371.00",
      facts: { account: "credit card", total: "$371.00", period: "the last 12 months" },
      charges: [],
    });
    expect(alternatives.length).toBeGreaterThan(0);
    for (const option of alternatives) expect(option).not.toMatch(/lower (?:interest )?rate/i);
  });
});
