import { describe, expect, it } from "vitest";
import { topicOf, withTopic } from "./context";

// Taxes QA (2026-10-22): "why?" after a tax answer got "Why what?", because tax answers never
// said what they were about.

describe("why, after a tax answer (taxes QA)", () => {
  const asOf = "2026-10-22";
  it("explains what the bill or refund is made of after 'how much will I owe'", () => {
    expect(
      withTopic({ kind: "explain" }, { kind: "tax", category: "decide", target: "owe" }, asOf),
    ).toEqual({ kind: "tax", ask: "decide", topic: "refund_why" });
  });

  it("asks a tax answer again, with its reasons, after the others", () => {
    expect(withTopic({ kind: "explain" }, { kind: "tax", category: "withholding" }, asOf)).toEqual({
      kind: "tax",
      ask: "withholding",
    });
    expect(
      withTopic({ kind: "explain" }, { kind: "tax", category: "decide", target: "itemize" }, asOf),
    ).toEqual({ kind: "tax", ask: "decide", topic: "itemize" });
  });

  it("records what a tax answer was about, only for answers that can be asked again", () => {
    expect(topicOf({ kind: "tax", ask: "decide", topic: "owe" })).toEqual({
      kind: "tax",
      category: "decide",
      target: "owe",
    });
    expect(topicOf({ kind: "tax", ask: "health" })).toEqual({ kind: "tax", category: "health" });
    expect(topicOf({ kind: "tax", ask: "set_county", county: "harris" })).toBeNull();
  });
});
