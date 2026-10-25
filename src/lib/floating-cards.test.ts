import { describe, expect, it } from "vitest";
import {
  answer,
  counter,
  currentCard,
  initialState,
  move,
  paragraphs,
  waiting,
  type FloatingCardData,
} from "./floating-cards";

const card = (id: string): FloatingCardData => ({
  id,
  headline: `Cancel ${id}, save $10/yr`,
  details: {},
  yesLabel: "Yes",
});
const cards = ["a", "b", "c"].map(card);

describe("a line of cards", () => {
  it("shows the first, counts what is left, and a Yes or Not now takes just that one", () => {
    expect(currentCard(cards, initialState)?.id).toBe("a");
    expect(counter(cards, initialState, "queue")).toBe("3 left");
    const after = answer(cards, initialState, "queue", "a");
    expect(currentCard(cards, after)?.id).toBe("b");
    expect(counter(cards, after, "queue")).toBe("2 left");
    expect(waiting(cards, after).map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("moves between waiting cards without losing any, and stops at the ends", () => {
    let state = move(cards, initialState, -1);
    expect(state.index).toBe(0);
    state = move(cards, move(cards, state, 1), 1);
    expect(currentCard(cards, state)?.id).toBe("c");
    expect(move(cards, state, 1).index).toBe(2);
    // Answering the last one leaves nothing showing.
    state = answer(
      cards,
      answer(cards, answer(cards, initialState, "queue", "a"), "queue", "b"),
      "queue",
      "c",
    );
    expect(currentCard(cards, state)).toBeNull();
    expect(counter(cards, state, "queue")).toBe("0 left");
  });

  it("keeps the place when the card that left was before the one showing", () => {
    const state = answer(cards, move(cards, initialState, 1), "queue", "b");
    expect(currentCard(cards, state)?.id).toBe("c");
  });
});

describe("the set changing under the card showing (the dock reloading)", () => {
  it("keeps the same card showing when a new one comes in ahead of it", () => {
    const state = move(cards, initialState, 1);
    expect(currentCard(cards, state)?.id).toBe("b");
    const reloaded = [card("new"), ...cards];
    expect(currentCard(reloaded, state)?.id).toBe("b");
    expect(currentCard(reloaded, move(reloaded, state, 1))?.id).toBe("c");
  });

  it("keeps it when a card ahead of it is gone from the set", () => {
    const state = move(cards, move(cards, initialState, 1), 1);
    expect(currentCard(cards, state)?.id).toBe("c");
    expect(currentCard([card("b"), card("c")], state)?.id).toBe("c");
  });

  it("falls back to the same place when the card itself is gone", () => {
    const state = move(cards, initialState, 1);
    expect(currentCard([card("a"), card("c")], state)?.id).toBe("c");
  });
});

describe("options to pick one from", () => {
  it("counts through the options, and a Yes on one decides the whole set", () => {
    let state = move(cards, initialState, 1);
    expect(counter(cards, state, "pick")).toBe("2 of 3");
    state = answer(cards, state, "pick", "b");
    expect(waiting(cards, state)).toEqual([]);
    expect(currentCard(cards, state)).toBeNull();
  });

  it("puts the whole set off with Not now", () => {
    const state = answer(cards, initialState, "pick", "a");
    expect(waiting(cards, state)).toHaveLength(0);
  });
});

describe("a card's details as paragraphs", () => {
  it("makes each line its own paragraph and skips blank lines", () => {
    expect(paragraphs("Your rent is due Friday.\n\nIt's $1,850.")).toEqual([
      { kind: "p", text: "Your rent is due Friday." },
      { kind: "p", text: "It's $1,850." },
    ]);
  });

  it("turns dashes and bullets into one list", () => {
    expect(paragraphs("Three things:\n- Cancel Hulu\n• Call the bank\n- Pay rent")).toEqual([
      { kind: "p", text: "Three things:" },
      { kind: "list", items: ["Cancel Hulu", "Call the bank", "Pay rent"] },
    ]);
  });

  it("splits a long run into groups of two sentences, keeping $3.50 whole", () => {
    const text =
      "It costs $3.50 a day. That's $1,277 a year. Most people keep it. You barely use it.";
    expect(paragraphs(text)).toEqual([
      { kind: "p", text: "It costs $3.50 a day. That's $1,277 a year." },
      { kind: "p", text: "Most people keep it. You barely use it." },
    ]);
    expect(paragraphs("One. Two. Three.")).toEqual([{ kind: "p", text: "One. Two. Three." }]);
  });
});
