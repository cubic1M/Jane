import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { parseIntent } from "../intents";

// Spec step 152: questions about cover that comes with a card.

describe("asking about a card's cover", () => {
  it.each([
    "does my card cover my phone?",
    "do my cards come with any insurance?",
    "what are my card benefits",
    "do I have rental car insurance",
    "am I paying twice for anything",
    "is extended warranty worth it",
  ])("reads %j as card cover", (text) => {
    expect(parseIntent(text, "2026-10-19")).toMatchObject({ kind: "insurance", ask: "cards" });
  });

  it("leaves other card questions to their own answers", () => {
    expect(parseIntent("what's my card balance", "2026-10-19")).not.toMatchObject({
      ask: "cards",
    });
    expect(parseIntent("what benefits do I get through work", "2026-10-19")).toMatchObject({
      ask: "benefits",
    });
  });
});
