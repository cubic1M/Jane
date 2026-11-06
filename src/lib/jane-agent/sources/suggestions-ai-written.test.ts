import { describe, expect, it } from "vitest";
import { STRATEGIST_CAPABILITY } from "@/config/strategist";
import type { OfferedSuggestion } from "@/lib/suggestions";
import type { Snapshot } from "../snapshot";
import type { SourceContext } from "./source";
import { suggestionsSource } from "./suggestions";

// A strategist idea (spec step 256) is Claude's own words, often about taxes or investing ("part
// of your bonus to the HSA to cut tax"), so its card carries AI_WRITTEN_LABEL as a chat answer
// would (src/config/advice.ts; Anthropic's Usage Policy from Nov 12, 2026). A detector's
// suggestion is written by rules and doesn't.

const offered = (key: string, topic: string): OfferedSuggestion => ({
  id: key,
  key,
  chosenOn: "2026-11-06",
  topic,
  title: "Put part of the bonus in the HSA to cut tax, the rest on the 9% car loan",
  headline: "Bonus: HSA and the car loan",
  short: "Your March bonus could do two jobs",
  why: "An HSA deposit lowers taxable income, and the car loan costs 9%.",
  worthCents: 120_000,
  worthKind: "yearly",
  confidencePercent: 70,
  confidenceReason: "your pay stubs",
  actionLabel: "See the HSA",
  actionHref: "/investments/hsa",
  more: [],
  advice: true,
});

const refsOf = (s: OfferedSuggestion) => {
  const [message] = suggestionsSource.gather(
    { suggestions: [s] } as unknown as Snapshot,
    {} as unknown as SourceContext,
  );
  return message!.refs as Record<string, unknown>;
};

describe("a suggestion's card", () => {
  it("says AI wrote it when it's a strategist idea", () => {
    expect(refsOf(offered(`${STRATEGIST_CAPABILITY}:hsa+car_loan`, "strategist")).aiWritten).toBe(
      true,
    );
  });

  it("doesn't when a detector's rules wrote it", () => {
    expect(refsOf(offered("hsa_room", "hsa")).aiWritten).toBeUndefined();
  });
});
