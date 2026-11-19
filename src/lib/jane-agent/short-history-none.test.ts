import { describe, expect, it } from "vitest";
import { comingUpReply, safeReply } from "./replies";
import { subscriptionsReply } from "./recurring-replies";
import type { Recurring } from "./recurring";

// Debug 3, 11-19 (class 6, debug3-invariants.md): someone with one month of statements asked the
// chat and heard "Nothing is coming up that I can see.", "I don't see any bills coming up" and "I
// don't see any subscriptions yet.", rent and all still to come: with less history than a monthly
// bill shows twice in, Home's strip says it can't tell yet, and so does the chat.

const none = { charges: [] } as unknown as Recurring;

describe("the chat's answers over too little history", () => {
  it("says what's coming up can't be seen yet", () => {
    expect(comingUpReply({ kind: "coming_up", days: null }, [], { shortHistory: true }).body).toBe(
      "Too little history to see your bills yet: they show once about two months of transactions are in.",
    );
  });

  it("says safe to spend leaves bills out because it can't see them yet", () => {
    const answer = safeReply({ safeCents: 845_000, payday: null, billsCents: 0 }, "2026-11-12", {
      shortHistory: true,
    });
    expect(answer.body).toContain("there's too little history to see your bills yet");
    expect(answer.body).not.toContain("I don't see any bills coming up");
  });

  it("says subscriptions can't be told yet", () => {
    expect(
      subscriptionsReply({ total: false, all: false }, none, null, { shortHistory: true }).body,
    ).toBe(
      "I don't see any subscriptions yet: there's too little history to tell. They show once about two months of transactions are in.",
    );
  });

  it("says none plainly with history enough to know", () => {
    expect(comingUpReply({ kind: "coming_up", days: null }, []).body).toBe(
      "Nothing is coming up that I can see.",
    );
    expect(subscriptionsReply({ total: false, all: false }, none, null).body).toBe(
      "I don't see any subscriptions yet.",
    );
  });
});
