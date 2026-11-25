import { describe, expect, it } from "vitest";
import { firstSentences, laterSentences, sentences } from "./tree";

// CodeRabbit sweep 1c, area-02 (#9): initials in a name don't end a sentence, so the preview and
// "More" stay on the same sentences.

describe("sentences with spaced initials", () => {
  const text = "J. P. Morgan was your biggest category. The total was $40.";
  it("keeps the name in its sentence", () => {
    expect(sentences(text)).toBe(2);
    expect(firstSentences(text, 1)).toBe("J. P. Morgan was your biggest category.");
    expect(laterSentences(text, 1)).toBe("The total was $40.");
  });
  it("still splits ordinary sentence endings", () => {
    const plain = "You paid $40. It was late! Was it a fee? Yes.";
    expect(sentences(plain)).toBe(4);
    expect(firstSentences(plain, 2)).toBe("You paid $40. It was late!");
    expect(laterSentences(plain, 2)).toBe("Was it a fee? Yes.");
  });
  it("splits after a capital that ends a name (H&M.), not only after lowercase words", () => {
    const text = "Your largest charge was H&M. The total was $40. Review the charge.";
    expect(sentences(text)).toBe(3);
    expect(laterSentences(text, 3)).toBe("");
  });
  it("keeps compact initials (J.P.) in their sentence", () => {
    const text = "J.P. Morgan was your biggest category. The total was $40.";
    expect(sentences(text)).toBe(2);
    expect(firstSentences(text, 1)).toBe("J.P. Morgan was your biggest category.");
  });
});
