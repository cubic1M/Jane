import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/chat/suggestion-cards", () => ({ SuggestionCards: () => null }));

import type { MessageView } from "@/lib/jane-agent/view";
import { keepShowing } from "./card-dock";

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
