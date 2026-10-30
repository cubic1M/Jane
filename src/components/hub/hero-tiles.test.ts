import { describe, expect, it } from "vitest";
import { foundWords } from "./hero-tiles";

// Night QA 10-30: Home read "Money found $0/yr" for a person with nothing found.
describe("foundWords", () => {
  const found = (cents: number) => ({ label: "Money found" as const, cents });

  it("says what's to look at, or nothing yet, instead of $0/yr", () => {
    expect(foundWords(found(0), 2)).toBe("2 to look at");
    expect(foundWords(found(0), 0)).toBe("Nothing yet");
  });

  it("leaves a dollar figure, and saved money, to the number", () => {
    expect(foundWords(found(63_728), 3)).toBeNull();
    expect(foundWords({ label: "Saved so far", cents: 0 }, 0)).toBeNull();
  });
});
