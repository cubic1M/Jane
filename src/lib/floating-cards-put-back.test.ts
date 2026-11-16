import { describe, expect, it } from "vitest";
import {
  answer,
  currentCard,
  initialState,
  putBack,
  waiting,
  type FloatingCardData,
} from "./floating-cards";

// Debug 3 (11-16): an answer sent while the network was down never reached Jane, and the card
// stayed hidden in that tab. A card whose answer didn't go through comes back, showing.
const cards: FloatingCardData[] = ["a", "b", "c"].map((id) => ({
  id,
  headline: id,
  details: {},
  yesLabel: "Yes",
}));

describe("a card whose answer didn't go through", () => {
  it("is waiting again and the one showing, though the person moved on", () => {
    const answered = answer(cards, initialState, "queue", "a");
    expect(currentCard(cards, answered)?.id).toBe("b");
    const back = putBack(cards, answered, ["a"]);
    expect(waiting(cards, back).map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(currentCard(cards, back)?.id).toBe("a");
  });

  it("leaves the stack alone when the card isn't gone, and keeps other answers gone", () => {
    const answered = answer(cards, answer(cards, initialState, "queue", "a"), "queue", "c");
    expect(putBack(cards, answered, ["b"])).toBe(answered);
    const back = putBack(cards, answered, ["c"]);
    expect(waiting(cards, back).map((c) => c.id)).toEqual(["b", "c"]);
    expect(currentCard(cards, back)?.id).toBe("c");
  });
});
