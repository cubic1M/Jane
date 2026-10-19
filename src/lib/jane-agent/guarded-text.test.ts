import { describe, expect, it } from "vitest";
import { GuardedText, sentenceEnd } from "./guarded-text";

// Claude's chat answer is shown as it's written, but only a whole sentence at a time, and
// only once everything shown so far passes the guardrails.

function guarded(allowed: number[] = []) {
  const shown: string[] = [];
  const text = new GuardedText(
    () => allowed,
    (t) => shown.push(t),
  );
  return { text, shown };
}

describe("sentenceEnd", () => {
  it.each([
    ["No end yet", 0],
    ["One. Two. Three", 4],
    ["Is it? Yes! And", 6],
    ["Due:\nRent", 4],
    ["Rent\nDue", 5],
    // A full stop inside a figure isn't the end of a sentence.
    ["You spent $1,200.50 on", 0],
    ["You spent $1,200.50. Then", 20],
    ["Yes!", 0],
  ])("finds where %j ends", (text, end) => {
    expect(sentenceEnd(text)).toBe(end);
  });
});

describe("GuardedText", () => {
  it("shows each sentence once it's complete, and the rest at the end", () => {
    const { text, shown } = guarded([120_050]);
    for (const piece of ["You sp", "ent $1,20", "0.50. Th", "at's all"]) text.push(piece);
    expect(shown).toEqual(["You spent $1,200.50."]);
    text.finish();
    expect(shown).toEqual(["You spent $1,200.50.", " That's all"]);
  });

  it("holds back a figure nothing supports, and everything after it", () => {
    const { text, shown } = guarded([500]);
    text.push("You have $5.00 left. You'll save $9,999.00 for sure. Then more. ");
    text.finish();
    expect(shown).toEqual(["You have $5.00 left."]);
  });

  it("holds back advice the guardrails refuse", () => {
    const { text, shown } = guarded();
    text.push("Good question. You should buy index funds now. ");
    text.finish();
    expect(shown).toEqual(["Good question."]);
  });

  it("starts again after a reset", () => {
    const { text, shown } = guarded();
    text.push("Let me look. ");
    text.reset();
    text.push("Nothing is due this week.");
    text.finish();
    expect(shown).toEqual(["Let me look.", "Nothing is due this week."]);
  });
});
