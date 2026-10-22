import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ tapButton: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { MessageView } from "@/lib/jane-agent/view";
import { SuggestionCards, cardOf, cardParts } from "./suggestion-cards";

// The day's suggestions as floating cards (founder request): the short card with Yes and Not
// now, the details already on the page, and nothing at all with none waiting.

const message = (n: number, over: Partial<MessageView> = {}): MessageView => ({
  id: `m${n}`,
  kind: "decision",
  fromJane: true,
  tag: "to decide",
  time: "Oct 19, 9:00 AM",
  body: `Cancel Hulu ${n}, save $216/yr\nWhy you: You pay $17.99 a month.\n85% sure: 12 months of charges.`,
  status: "open",
  answeredWith: null,
  note: null,
  advice: true,
  buttons: [
    { id: "suggestion.yes", label: "Cancel it", kind: "primary" },
    { id: "snooze", label: "Not now", kind: "secondary" },
    { id: "suggestion.no", label: "Not for me", kind: "secondary" },
    { id: "suggestion.why", label: "Why?", kind: "quick" },
  ],
  links: [{ label: "Open", href: "/subscriptions" }],
  undoUntil: null,
  block: null,
  pinned: false,
  suggestion: true,
  options: null,
  ...over,
});

describe("reading a suggestion's body", () => {
  it("splits it into headline, why you and how sure", () => {
    expect(cardParts(message(1).body)).toEqual({
      headline: "Cancel Hulu 1, save $216/yr",
      why: "You pay $17.99 a month.",
      percent: 85,
      reason: "12 months of charges",
    });
  });

  it("falls back to the first line and the rest when the body is another shape", () => {
    expect(cardParts("Cancel Hulu.\nYou pay $17.99 a month.")).toMatchObject({
      headline: "Cancel Hulu.",
      why: "You pay $17.99 a month.",
      percent: null,
    });
  });
});

describe("the card", () => {
  it("is the headline, with the reasoning and what Yes does kept for More details", () => {
    const card = cardOf(message(1));
    expect(card.headline).toBe("Cancel Hulu 1, save $216/yr");
    expect(card.details).toMatchObject({
      why: "You pay $17.99 a month.",
      confidence: { percent: 85, reason: "12 months of charges" },
      notes: ["Demo advice: sample data, not financial advice"],
    });
    expect(card.details.whatYesDoes).toMatch(/^Cancel it\. Nothing is bought or moved/);
  });
});

describe("the overlay", () => {
  const html = renderToStaticMarkup(
    <SuggestionCards messages={[message(1), message(2), message(3)]} />,
  );

  it("shows the first card with Yes, Not now and More details, and the count", () => {
    expect(html).toContain("3 left");
    expect(html).toContain("Cancel Hulu 1, save $216/yr");
    expect(html).toContain(">Yes<");
    expect(html).toContain(">Not now<");
    expect(html).toContain("More details");
    expect(html).toContain('aria-label="Suggestions for you"');
    expect(html).toContain("fixed");
  });

  it("has the details on the page already, hidden", () => {
    expect(html).toContain("Why you:");
    expect(html).toContain("85% sure:");
    expect(html).toMatch(/hidden=""/);
    expect(html).toContain("Don&#x27;t suggest this again");
  });

  it("shows one card at a time", () => {
    expect(html).not.toContain("Cancel Hulu 2");
  });

  it("is nothing with none waiting", () => {
    expect(renderToStaticMarkup(<SuggestionCards messages={[]} />)).toBe("");
  });
});
