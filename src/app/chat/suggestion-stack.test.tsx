import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ tapButton: vi.fn() }));

import type { MessageView } from "@/lib/jane-agent/view";
import { SuggestionStack, cardParts } from "./suggestion-stack";

// The day's suggestions as one card at a time (founder request): "1 of N", Back and Next,
// the short form on each card, and nothing at all with none waiting.

const card = (n: number, over: Partial<MessageView> = {}): MessageView => ({
  id: `m${n}`,
  kind: "decision",
  fromJane: true,
  tag: "to decide",
  time: "Oct 19, 9:00 AM",
  body: `Cancel Hulu ${n}, save $216 a year\nWhy you: You pay $17.99 a month.\n85% sure: 12 months of charges.`,
  status: "open",
  answeredWith: null,
  note: null,
  advice: false,
  buttons: [
    { id: "suggestion.yes", label: "Cancel it", kind: "primary" },
    { id: "suggestion.no", label: "Not for me", kind: "secondary" },
    { id: "suggestion.why", label: "Why?", kind: "quick" },
  ],
  links: [{ label: "Open", href: "/subscriptions" }],
  undoUntil: null,
  block: null,
  pinned: false,
  suggestion: true,
  ...over,
});

describe("reading a card's body", () => {
  it("splits the short form into headline, why you and how sure", () => {
    expect(cardParts(card(1).body)).toEqual({
      headline: "Cancel Hulu 1, save $216 a year",
      why: "You pay $17.99 a month.",
      percent: 85,
      reason: "12 months of charges",
      whole: null,
    });
  });

  it("shows the whole explanation after Why?", () => {
    const whole = "Cancel Hulu.\nYou pay $17.99 a month and use it twice. I'm 85% sure.";
    expect(cardParts(whole)).toMatchObject({ headline: "Cancel Hulu.", whole });
  });
});

describe("the stack", () => {
  const html = renderToStaticMarkup(<SuggestionStack messages={[card(1), card(2), card(3)]} />);

  it("starts on the first of N, with the short card and its buttons", () => {
    expect(html).toContain("1 of 3");
    expect(html).toContain("Cancel Hulu 1, save $216 a year");
    expect(html).toContain("Why you:");
    expect(html).toContain("85% sure");
    for (const name of ["Cancel it", "Not for me", "Why?", "Hide"]) expect(html).toContain(name);
    // Only the current card is there: no scrolling through a list.
    expect(html).not.toContain("Cancel Hulu 2");
  });

  it("can't go back from the first card, and names its controls", () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous suggestion"/);
    expect(html).toContain('aria-label="Next suggestion"');
    expect(html).toContain('aria-label="Suggestions for you"');
    expect(html).toContain('aria-live="polite"');
  });

  it("shows nothing when none are waiting", () => {
    expect(renderToStaticMarkup(<SuggestionStack messages={[]} />)).toBe("");
  });
});
