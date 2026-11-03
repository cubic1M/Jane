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
  const ME = "user_1";

  it("paints the last cards at once, so the chat under them doesn't jump", () => {
    expect(keptCards(storage(JSON.stringify([m("a"), m("b")])), ME).map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });

  // Local build: 9 KB of decision cards were still in the tab after signing out, and the next person
  // to sign in there would see them first.
  it("never shows one person the cards kept for another", () => {
    const kept = new Map([["jane:dock-cards:user_1", JSON.stringify([m("a")])]]);
    const tab = { getItem: (key: string) => kept.get(key) ?? null };
    expect(keptCards(tab, "user_1").map((c) => c.id)).toEqual(["a"]);
    expect(keptCards(tab, "user_2")).toEqual([]);
  });

  it("starts empty with nothing kept, something broken, or no storage", () => {
    expect(keptCards(storage(null), ME)).toEqual([]);
    expect(keptCards(storage("{not json"), ME)).toEqual([]);
    expect(keptCards(storage('{"a":1}'), ME)).toEqual([]);
    expect(keptCards(undefined, ME)).toEqual([]);
  });
});

// Founder: a card followed to its page came straight back there. One dealt with in this tab is
// never kept, nor let back in by a load that crossed its answer.
describe("the dock and the cards dealt with", () => {
  it("never keeps one dealt with, even the card that was showing", () => {
    expect(keepShowing([m("a"), m("b")], [m("a"), m("b")], "a", ["a"]).map((c) => c.id)).toEqual([
      "b",
    ]);
    // A load that started before the answer landed still has it: left out.
    expect(keepShowing([m("a")], [m("a"), m("n")], "n", ["a"]).map((c) => c.id)).toEqual(["n"]);
    // The showing card kept in its place, the dealt-with one not.
    expect(
      keepShowing([m("a"), m("b"), m("c")], [m("a"), m("c")], "b", ["c"]).map((c) => c.id),
    ).toEqual(["a", "b"]);
  });

  it("drops it from the copy kept for the tab", () => {
    const storage = { getItem: () => JSON.stringify([m("a"), m("b")]) };
    expect(keptCards(storage, "user_1", ["a"]).map((c) => c.id)).toEqual(["b"]);
  });
});
