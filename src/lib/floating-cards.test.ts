import { describe, expect, it } from "vitest";
import {
  answer,
  counter,
  currentCard,
  initialState,
  move,
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
