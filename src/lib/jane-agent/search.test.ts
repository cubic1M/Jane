import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { parseIntent } from "./intents";
import { parseSearch } from "./search";

// Spec step 96: what a search looks for, and typed search. (The week's summary is a line of
// the Monday brief: sources-upkeep.test.ts.)

const TODAY = "2026-10-19";

describe("parseSearch", () => {
  it("reads words, an amount and a day", () => {
    expect(parseSearch("Netflix $17.99", TODAY)).toEqual({
      words: ["netflix"],
      amountCents: 1799,
      date: null,
    });
    expect(parseSearch("hulu 11.99", TODAY)).toMatchObject({ amountCents: 1199 });
    expect(parseSearch("$145", TODAY)).toMatchObject({ amountCents: 14500, words: [] });
    expect(parseSearch("refund on Oct 2", TODAY)).toEqual({
      words: ["refund", "on"],
      amountCents: null,
      date: "2026-10-02",
    });
    // A day later than today is last year's.
    expect(parseSearch("Dec 24", TODAY).date).toBe("2025-12-24");
    expect(parseSearch("2026-09-14", TODAY).date).toBe("2026-09-14");
    expect(parseSearch("a", TODAY)).toEqual({ words: [], amountCents: null, date: null });
  });

  it("is what the rules read typed searches as", () => {
    expect(parseIntent("search for Netflix", TODAY)).toEqual({ kind: "search", query: "netflix" });
    expect(parseIntent("find hulu in the chat", TODAY)).toEqual({ kind: "search", query: "hulu" });
    expect(parseIntent("where did you say peacock", TODAY)).toEqual({
      kind: "search",
      query: "peacock",
    });
  });
});
