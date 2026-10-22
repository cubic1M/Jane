import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ tapButton: vi.fn() }));
vi.mock("./practice-actions", () => ({ putAwayPracticeCard: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { FloatingCardData } from "@/lib/floating-cards";
import type { MessageView } from "@/lib/jane-agent/view";
import { ChatCards, optionAction } from "./chat-cards";

// The one place cards float over the chat, one set at a time: the options Jane just gave first,
// as the pick card, then the day's suggestions, then the practice portfolio's cards.

const base: MessageView = {
  id: "m1",
  kind: "reply",
  fromJane: true,
  tag: "answer",
  time: "Oct 19, 9:00 AM",
  body: "You need about $500,000 of term life.",
  status: "open",
  answeredWith: null,
  note: null,
  advice: true,
  buttons: [],
  links: [],
  undoUntil: null,
  block: null,
  pinned: false,
  suggestion: false,
  options: null,
};

const withOptions: MessageView = {
  ...base,
  options: {
    title: "Choose your life cover",
    options: [
      {
        id: "pick",
        headline: "Lighthouse, $480/yr",
        summary: "The least for the cover you need.",
        details: { notes: ["Demo advice: sample data, not financial advice"] },
        badge: "Jane's pick",
        yesLabel: "Pick this one",
        notNowLabel: "Later",
      },
      {
        id: "dear",
        headline: "Harbor, $520/yr",
        summary: "Higher rated.",
        details: {},
        yesLabel: "Pick this one",
        notNowLabel: "Later",
      },
    ],
  },
};

const suggestion: MessageView = {
  ...base,
  id: "s1",
  kind: "decision",
  body: "Cancel Hulu, save $216/yr\nWhy you: You pay $17.99 a month.\n85% sure: 12 charges.",
  suggestion: true,
  buttons: [{ id: "suggestion.yes", label: "Cancel it", kind: "primary" }],
};

describe("ChatCards", () => {
  it("shows the options Jane gave first, as the pick card, ahead of the suggestions", () => {
    const html = renderToStaticMarkup(
      <ChatCards options={withOptions} suggestions={[suggestion]} />,
    );
    expect(html).toContain('data-floating-cards="pick"');
    expect(html).toContain('aria-label="Choose your life cover"');
    expect(html).toContain("1 of 2");
    expect(html).toContain("Lighthouse, $480/yr");
    expect(html).toContain("Jane&#x27;s pick");
    expect(html).toContain("The least for the cover you need.");
    expect(html).toContain("Pick this one");
    expect(html).toContain("Later");
    expect(html).not.toContain("Cancel Hulu");
  });

  it("shows the suggestions when there are no options waiting", () => {
    const html = renderToStaticMarkup(<ChatCards options={null} suggestions={[suggestion]} />);
    expect(html).toContain('data-floating-cards="queue"');
    expect(html).toContain("Cancel Hulu, save $216/yr");
  });

  it("is nothing at all with no cards of any kind", () => {
    expect(renderToStaticMarkup(<ChatCards options={null} suggestions={[]} />)).toBe("");
  });

  it("shows the practice portfolio's cards only once the options and suggestions are done", () => {
    const practice: FloatingCardData[] = [
      { id: "p1", headline: "Your practice portfolio is down 6%", details: {}, yesLabel: "Pause" },
    ];
    const last = renderToStaticMarkup(
      <ChatCards options={null} suggestions={[]} practice={practice} />,
    );
    expect(last).toContain('aria-label="Your practice portfolio"');
    expect(last).toContain("Your practice portfolio is down 6%");
    for (const html of [
      renderToStaticMarkup(
        <ChatCards options={null} suggestions={[suggestion]} practice={practice} />,
      ),
      renderToStaticMarkup(
        <ChatCards options={withOptions} suggestions={[]} practice={practice} />,
      ),
    ]) {
      expect(html).not.toContain("Your practice portfolio is down 6%");
    }
  });

  it("sends a pick as option.pick and anything else as option.later", () => {
    expect(optionAction("yes")).toBe("option.pick");
    expect(optionAction("not_now")).toBe("option.later");
    expect(optionAction("never")).toBe("option.later");
  });
});
