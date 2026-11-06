import { describe, expect, it } from "vitest";
import type { OfferedSuggestion } from "@/lib/suggestions";
import { ideaId } from "@/planning/strategist";
import type { Snapshot } from "../snapshot";
import type { SourceContext } from "./source";
import { suggestionsSource } from "./suggestions";

// Anthropic's usage policy (from Nov 12, 2026): what Claude writes about someone's money says AI
// was involved. A strategist idea (step 256) is Claude's own title and explanation, so its
// message carries aiWritten; a detector's suggestion is fixed wording and doesn't.

const offered = (key: string, over: Partial<OfferedSuggestion> = {}): OfferedSuggestion => ({
  id: `row-${key}`,
  chosenOn: "2026-11-06",
  key,
  topic: "strategist",
  title: "Your bonus: part to the HSA, the rest to the car loan",
  headline: "Bonus to the HSA and car loan",
  short: "Your $2,000 bonus covers both.",
  why: "Your $2,000 bonus covers both.",
  worthCents: 40_000,
  worthKind: "saves",
  confidencePercent: 70,
  confidenceReason: "the weakest part of this idea",
  actionLabel: "Open",
  actionHref: "/taxes",
  more: [],
  advice: false,
  ...over,
});

const gather = (suggestions: OfferedSuggestion[]) =>
  suggestionsSource.gather({ suggestions } as unknown as Snapshot, {} as SourceContext);

describe("a strategist idea says Claude wrote it", () => {
  it("marks an idea's message, on a real account and in demo advice alike", () => {
    const key = ideaId(["hsa:room", "loans:car_payoff"]);
    for (const advice of [false, true]) {
      const [message] = gather([offered(key, { advice })]);
      expect(message.refs.aiWritten).toBe(true);
    }
  });

  it("leaves a detector's own suggestion unmarked", () => {
    const [message] = gather([offered("subscriptions:unused", { topic: "subscriptions" })]);
    expect(message.refs.aiWritten).toBeUndefined();
  });
});
