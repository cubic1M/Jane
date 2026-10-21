import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { resolvePronoun, topicOf } from "./context";
import { parseIntent } from "./intents";

// "How do I improve it" right after the credit score is about the credit score, never an old
// card's button.

const ASOF = "2026-10-19";
const parse = (t: string) => parseIntent(t, ASOF);

describe("pointing back with 'it'", () => {
  it("names the kind of answer as the topic", () => {
    expect(topicOf({ kind: "credit_score" })).toEqual({ kind: "credit_score" });
  });

  it("reads a pointing-back question against the last answer", () => {
    const topic = { kind: "credit_score" };
    for (const text of ["how do i improve it", "how can i raise it", "why is it low"]) {
      const intent = resolvePronoun(text, parse(text), topic, parse);
      expect(intent.kind, text).not.toBe("unknown");
      expect(intent.kind, text).not.toBe("about");
    }
  });

  it("leaves it alone without a topic, or when it can't be read either way", () => {
    expect(
      resolvePronoun("how do i improve it", parse("how do i improve it"), null, parse),
    ).toEqual({ kind: "unknown" });
    expect(resolvePronoun("blah it", parse("blah it"), { kind: "credit_score" }, parse).kind).toBe(
      "about",
    );
  });
});
