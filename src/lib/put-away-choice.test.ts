import { describe, expect, it } from "vitest";
import { UNDO_NEVER, UNDO_SNOOZE, UNDO_SUGGEST_NEVER } from "@/config/put-away";
import { afterAnswer, putAwayBy } from "./put-away";

// Debug 3 (11-16, re-walking #1964): a finding's card has its own "Don't suggest again", a choice
// on the card rather than the stack's Not now, and it left no way back ("pressed on Theo's
// Spotify card it was gone for good"). A choice that puts the card away leaves the line too.

const items = [{ id: "a" }, { id: "b" }];

describe("what an answer leaves to bring the card back", () => {
  it("a card's own Don't suggest again puts it away, with its own way back", () => {
    expect(putAwayBy("yes", "suggest.never", "suggest.never")).toBe(UNDO_SUGGEST_NEVER);
    expect(
      afterAnswer(items, "b", "not_now", putAwayBy("yes", "suggest.never", "suggest.never")),
    ).toEqual({ item: items[1], index: 1, undo: UNDO_SUGGEST_NEVER });
  });

  it("Yes and the other choices leave none; Not now and a suggestion's no as before", () => {
    expect(putAwayBy("yes", undefined, "finding.yes")).toBe(false);
    expect(putAwayBy("yes", "finding.no", "finding.no")).toBe(false);
    expect(putAwayBy("yes", "finding.pick", "finding.pick")).toBe(false);
    expect(putAwayBy("not_now", undefined, "snooze")).toBe(UNDO_SNOOZE);
    expect(putAwayBy("never", undefined, "suggestion.no")).toBe(UNDO_NEVER);
    expect(putAwayBy("not_now", undefined, null)).toBeNull();
    expect(
      afterAnswer(items, "a", "not_now", putAwayBy("yes", undefined, "finding.yes")),
    ).toBeNull();
  });
});
