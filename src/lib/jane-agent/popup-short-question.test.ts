import { describe, expect, it } from "vitest";
import { firstSentence, popupCard } from "./popups";
import type { MessageView } from "./view";

// Debugger 11-14: a demo-bank student's dock card said only "Charged twice?"; which charge, and
// how much, was behind More details ("$64.20 at Target. Could get back about $64.20."). A short
// question brings the sentence that says what it's about; a longer one still ends the headline.

const message = (body: string): MessageView =>
  ({
    id: "m1",
    kind: "decision",
    fromJane: true,
    tag: "",
    time: "",
    body,
    status: "open",
    answeredWith: null,
    note: null,
    advice: false,
    buttons: [{ id: "finding.yes", label: "Yes", kind: "primary" }],
    links: [],
    undoUntil: null,
    block: null,
    pinned: false,
    suggestion: false,
    options: null,
  }) as unknown as MessageView;

describe("a card that opens with a short question", () => {
  it("says what the question is about on its face", () => {
    const card = popupCard(
      message(
        "Charged twice? $64.20 at Target. Could get back about $64.20. Want me to handle it?",
      ),
    );
    expect(card.headline).toBe("Charged twice? $64.20 at Target.");
    expect(card.details.about).toBe("Could get back about $64.20. Want me to handle it?");
  });

  it("keeps a longer question as the whole headline", () => {
    expect(firstSentence("How much should I do on my own? Pick one.")).toBe(
      "How much should I do on my own?",
    );
  });

  it("is the whole line when nothing follows", () => {
    expect(firstSentence("Charged twice?")).toBe("Charged twice?");
  });
});
