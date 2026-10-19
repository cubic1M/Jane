import { describe, expect, it } from "vitest";
import { unansweredByKind } from "./unanswered";

// Spec step 93: what Jane couldn't answer, by kind, from the events' kinds and codes only.
describe("unansweredByKind", () => {
  it("counts what didn't get an answer by kind and how, and blocks by rule", () => {
    const events = [
      { properties: { intent: "safe_to_spend", source: "rules" } },
      { properties: { intent: "unknown", source: "fallback" } },
      { properties: { intent: "unknown", source: "fallback" } },
      { properties: { intent: "unknown", source: "claude_unavailable" } },
      {
        properties: {
          intent: "unknown",
          source: "claude_blocked",
          issues: "tax_or_legal_advice,unsupported_dollar_figure",
        },
      },
      { properties: { intent: "about", source: "claude_blocked", issues: "tax_or_legal_advice" } },
      { properties: null },
    ];
    expect(unansweredByKind(events)).toEqual({
      asked: 7,
      notAnswered: 5,
      byKind: [
        { intent: "unknown", how: "fallback", count: 2 },
        { intent: "about", how: "claude_blocked", count: 1 },
        { intent: "unknown", how: "claude_blocked", count: 1 },
        { intent: "unknown", how: "claude_unavailable", count: 1 },
      ],
      blockedBy: [
        { issue: "tax_or_legal_advice", count: 2 },
        { issue: "unsupported_dollar_figure", count: 1 },
      ],
    });
  });
});
