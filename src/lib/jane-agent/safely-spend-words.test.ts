import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-16 (a one-month Chase upload on a phone): "how much can I safely spend?" read "You
// spent $144.93 in November 2026 so far", the month's spending, not safe to spend.

const intent = (text: string) => parseIntent(text, "2026-11-16");

describe("safe to spend, asked with safely", () => {
  it("is safe to spend", () => {
    for (const text of [
      "how much can I safely spend?",
      "what can I safely spend this week",
      "how much is safe for me to spend",
    ]) {
      expect(intent(text), text).toEqual({ kind: "safe_to_spend" });
    }
  });

  it("what was spent is still what was spent", () => {
    expect(intent("how much did I spend this month")).toMatchObject({ kind: "spending" });
  });
});
