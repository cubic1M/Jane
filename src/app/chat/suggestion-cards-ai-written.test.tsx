import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ tapButton: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AI_WRITTEN_LABEL, DEMO_ADVICE_LABEL } from "@/config/advice";
import type { MessageView } from "@/lib/jane-agent/view";
import { cardOf } from "./suggestion-cards";

// A strategist idea's card says on its face that AI wrote it (Anthropic's usage policy from Nov
// 12, 2026), beside the demo-advice label when there is one; not behind More details.

const message = (over: Partial<MessageView> = {}): MessageView => ({
  id: "m1",
  kind: "decision",
  fromJane: true,
  tag: "to decide",
  time: "Nov 6, 9:00 AM",
  body: "Bonus to the HSA and car loan\nWhy you: Your $2,000 bonus covers both.\n70% sure: the weakest part.",
  status: "open",
  answeredWith: null,
  note: null,
  advice: false,
  buttons: [{ id: "suggestion.yes", label: "Open", kind: "primary" }],
  links: [],
  undoUntil: null,
  block: null,
  pinned: false,
  suggestion: true,
  options: null,
  ...over,
});

describe("the AI note on a suggestion card", () => {
  it("shows on an idea's card face", () => {
    expect(cardOf(message({ aiWritten: true })).badge).toBe(AI_WRITTEN_LABEL);
  });

  it("sits beside the demo-advice label", () => {
    const badge = cardOf(message({ aiWritten: true, advice: true })).badge ?? "";
    expect(badge).toContain(DEMO_ADVICE_LABEL);
    expect(badge).toContain(AI_WRITTEN_LABEL);
  });

  it("isn't on a detector's card", () => {
    expect(cardOf(message()).badge).toBeUndefined();
    expect(cardOf(message({ advice: true })).badge).toBe(DEMO_ADVICE_LABEL);
  });
});
