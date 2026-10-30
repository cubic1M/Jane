import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ tapButton: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { MessageView } from "@/lib/jane-agent/view";
import { SuggestionCards, cardOf, cardParts, followAction } from "./suggestion-cards";

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

describe("a practice idea's card (Phase AW)", () => {
  const idea = message(9, {
    body: "Harvest a $412 loss in VTI, in practice\nWhy you: VTI is worth $4,100.00 against $4,512.00 paid; ITOT keeps the same mix.\n75% sure: The loss is there today.",
    buttons: [{ id: "suggestion.yes", label: "Do it in practice", kind: "primary" }],
    cardDetails: {
      figures: [
        { label: "Loss", value: "$412.00" },
        { label: "Swapped into", value: "ITOT" },
      ],
      caps: ["At most 70% of the portfolio", "At most 2 swaps a month"],
      whatYesDoes:
        "Places it in your practice portfolio, within the caps. Practice money only: nothing real is bought or sold.",
    },
  });

  it("shows the numbers, the caps, the confidence and what Yes really does under More details", () => {
    const card = cardOf(idea);
    expect(card.headline).toBe("Harvest a $412 loss in VTI, in practice");
    expect(card.details.figures).toEqual([
      { label: "Loss", value: "$412.00" },
      { label: "Swapped into", value: "ITOT" },
    ]);
    expect(card.details.notes).toEqual([
      "Cap: At most 70% of the portfolio",
      "Cap: At most 2 swaps a month",
      "Demo advice: sample data, not financial advice",
    ]);
    expect(card.details.confidence).toEqual({ percent: 75, reason: "The loss is there today" });
    expect(card.details.whatYesDoes).toMatch(
      /^Do it in practice\. Places it in your practice portfolio/,
    );
    expect(card.details.whatYesDoes).not.toMatch(/Nothing is bought or moved/);
  });

  it("leaves other suggestions' cards as they were", () => {
    const card = cardOf(message(1));
    expect(card.details.figures).toBeUndefined();
    expect(card.details.whatYesDoes).toMatch(/Nothing is bought or moved/);
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

  it("explains the headline's figure with the whole reason when there is one", () => {
    const why =
      "Your company stock is $259,160.00, 64% of everything you invest. If it fell by 30% you would lose $77,748.00, and your job rides on the same company.";
    expect(cardOf(message(1, { cardWhy: why })).details.why).toBe(why);
  });

  it("says in More details what people did with this kind (the learning loop)", () => {
    const people = "People acted on this 7 of 10 times it was shown.";
    expect(cardOf(message(1, { cardPeople: people })).details.notes?.[0]).toBe(people);
    expect(cardOf(message(1, { advice: false })).details.notes).toBeUndefined();
    expect(cardOf(message(1, { advice: false, cardPeople: people })).details.notes).toEqual([
      people,
    ]);
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

// Following a card to its page is engaging with it, never "done" (the savings record stays an
// estimate until the transactions show it).
describe("following a card to its page", () => {
  type Button = MessageView["buttons"][number];
  const button = (id: Button["id"]): Button => ({ id, label: id, kind: "primary" });
  it("is a suggestion's own Yes, else its Not now, else nothing on the server", () => {
    expect(
      followAction({ suggestion: true, buttons: [button("suggestion.yes"), button("snooze")] }),
    ).toBe("suggestion.yes");
    expect(
      followAction({ suggestion: false, buttons: [button("finding.yes"), button("snooze")] }),
    ).toBe("snooze");
    expect(followAction({ suggestion: false, buttons: [button("finding.yes")] })).toBeNull();
    expect(followAction({ suggestion: true, buttons: [] })).toBeNull();
  });
});
