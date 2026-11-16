import { describe, expect, it } from "vitest";
import { UNDO_NEVER, UNDO_SNOOZE } from "@/config/put-away";
import {
  answer,
  bringBack,
  currentCard,
  initialState,
  waiting,
  type FloatingCardData,
} from "./floating-cards";
import { afterAnswer, undoOf, withReturned, type Away } from "./put-away";

// Founder (11-16): "there should be an option to go back to the suggestion that they just clicked
// close". The line left where a card was put away, and what bringing it back does to the stack.

type Item = { id: string };
const items: Item[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
const ids = (list: readonly { id: string }[]) => list.map((m) => m.id);
const card = (id: string): FloatingCardData => ({ id, headline: id, details: {}, yesLabel: "Yes" });

describe("which answers leave a way back", () => {
  it("Not now and Don't suggest this again do; a practice idea's no and other buttons don't", () => {
    expect(undoOf("snooze")).toBe(UNDO_SNOOZE);
    expect(undoOf("suggestion.no")).toBe(UNDO_NEVER);
    expect(undoOf("suggestion.no", { practice: true })).toBe(false);
    // Put off on this screen only: nothing to undo on the server, the line still shows.
    expect(undoOf(null)).toBeNull();
    expect(undoOf(undefined)).toBeNull();
    expect(undoOf("offer.decline")).toBe(false);
  });

  it("only a put-away leaves a line, and any other answer takes it away", () => {
    expect(afterAnswer(items, "b", "not_now", UNDO_SNOOZE)).toEqual({
      item: items[1],
      index: 1,
      undo: UNDO_SNOOZE,
    });
    expect(afterAnswer(items, "b", "never", null)?.undo).toBeNull();
    expect(afterAnswer(items, "b", "yes", UNDO_SNOOZE)).toBeNull();
    expect(afterAnswer(items, "b", "not_now", false)).toBeNull();
    expect(afterAnswer(items, "z", "not_now", UNDO_SNOOZE)).toBeNull();
  });
});

describe("a card put away and brought back", () => {
  it("comes back in its place and showing, again and again, after a reload and a failed send", () => {
    // Put away: gone from the list, its line showing.
    let gone = new Set(["b"]);
    let away = afterAnswer(items, "b", "not_now", UNDO_SNOOZE);
    let returned: Away<Item>[] = [];
    expect(
      ids(
        withReturned(
          items.filter((m) => !gone.has(m.id)),
          returned,
          gone,
        ),
      ),
    ).toEqual(["a", "c"]);
    const cards = items.map((m) => card(m.id));
    let state = answer(cards, initialState, "queue", "b");
    expect(currentCard(cards, state)?.id).toBe("c");

    // Brought back: the same place, showing.
    returned = [away!];
    gone = new Set();
    away = null;
    expect(ids(withReturned(items, returned, gone))).toEqual(["a", "b", "c"]);
    state = bringBack(state, "b");
    expect(currentCard(cards, state)?.id).toBe("b");
    expect(ids(waiting(cards, state))).toEqual(["a", "b", "c"]);

    // Put away again: gone again though it was brought back, and its line again. (What a stack
    // is given has its gone cards left out first, as SuggestionCards does.)
    away = afterAnswer(withReturned(items, returned, gone), "b", "not_now", UNDO_SNOOZE);
    gone = new Set(["b"]);
    const notGone = items.filter((m) => !gone.has(m.id));
    expect(ids(withReturned(notGone, returned, gone))).toEqual(["a", "c"]);
    expect(away?.item.id).toBe("b");

    // A reload since left it out (its put-away reached the server): brought back, it's still in
    // its place.
    const reloaded = [items[0], items[2]];
    gone = new Set();
    expect(ids(withReturned(reloaded, [away!], gone))).toEqual(["a", "b", "c"]);

    // Bringing it back never reached the server: put away here too, the line back to try again.
    gone = new Set(["b"]);
    returned = [];
    expect(ids(withReturned(reloaded, returned, gone))).toEqual(["a", "c"]);
    expect(away?.item.id).toBe("b");

    // Another card answered: the line goes.
    expect(afterAnswer(items, "a", "yes", false)).toBeNull();
  });

  it("shows even when this stack never had it gone (it went from another stack)", () => {
    const cards = items.map((m) => card(m.id));
    const state = bringBack(initialState, "c");
    expect(currentCard(cards, state)?.id).toBe("c");
  });
});
