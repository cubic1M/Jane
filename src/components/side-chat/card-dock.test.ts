import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/chat/suggestion-cards", () => ({ SuggestionCards: () => null }));

import type { MessageView } from "@/lib/jane-agent/view";
import { keepShowing, keptCards } from "./card-dock";

const m = (id: string) => ({ id }) as MessageView;

describe("the dock reloading its cards", () => {
  it("takes the new set as it is when the card showing is still in it", () => {
    expect(keepShowing([m("a"), m("b")], [m("n"), m("a"), m("b")], "b").map((c) => c.id)).toEqual([
      "n",
      "a",
      "b",
    ]);
  });

  it("keeps the card showing, in its place, when the reload left it out", () => {
    expect(keepShowing([m("a"), m("b"), m("c")], [m("a"), m("c")], "b").map((c) => c.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("lets a card go once nothing is showing it", () => {
    expect(keepShowing([m("a"), m("b")], [m("a")], null).map((c) => c.id)).toEqual(["a"]);
  });
});

describe("the cards kept for the tab", () => {
  const storage = (value: string | null) => ({ getItem: () => value });

  it("paints the last cards at once, so the chat under them doesn't jump", () => {
    expect(keptCards(storage(JSON.stringify([m("a"), m("b")]))).map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("starts empty with nothing kept, something broken, or no storage", () => {
    expect(keptCards(storage(null))).toEqual([]);
    expect(keptCards(storage("{not json"))).toEqual([]);
    expect(keptCards(storage('{"a":1}'))).toEqual([]);
    expect(keptCards(undefined)).toEqual([]);
  });
});
