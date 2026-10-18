import { describe, expect, it } from "vitest";
import { MAX_AFFORD_CENTS } from "@/config/afford";
import { checkGuardrails, recommendsAChoice } from "@/lib/guardrails";
import { AFFORD_COPY, allAffordCopy, reachedByLine, shortLine } from "./afford-copy";

// The dollar figures in the sample lines of allAffordCopy.
const SAMPLE_CENTS = [120_000, 95_000, 10_000, 12_000, 5_000, 0, MAX_AFFORD_CENTS];

describe("can-I-afford-this wording", () => {
  it.each(allAffordCopy())("never recommends a choice: %s", (text) => {
    expect(recommendsAChoice(text)).toBe(false);
    expect(checkGuardrails(text, SAMPLE_CENTS)).toEqual({ ok: true });
  });

  it("never says whether it's affordable", () => {
    for (const text of allAffordCopy()) {
      expect(text, text).not.toMatch(/\b(you can|you can't|you cannot) afford\b|\baffordable\b/i);
    }
  });

  it("says plainly that it's math, not a recommendation", () => {
    expect(AFFORD_COPY.disclaimer).toMatch(/^This is math, not a recommendation\./);
  });

  it("says when a goal isn't reached at the new pace", () => {
    expect(reachedByLine("Trip", { before: "$100.00", after: "$0.00" }, "Oct 2027", null)).toBe(
      "Trip, at $100.00 → $0.00 a month: reached by Oct 2027 → not within 50 years.",
    );
  });

  it("names the first month below zero, before and after", () => {
    expect(shortLine(null, null)).toMatch(/stays above zero/);
    expect(shortLine(null, "January 2027")).toBe(
      "Checking goes below zero in January 2027 after the change.",
    );
    expect(shortLine("March 2027", "January 2027")).toMatch(/March 2027 before .* January 2027/);
  });
});
