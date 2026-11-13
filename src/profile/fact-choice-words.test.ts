import { describe, expect, it } from "vitest";
import { choiceWords, factWords } from "./facts";

// Debugger 11-13, What Jane knows on a phone: the tax-filing choice "single" read "just you", the
// household's words for the same code.

describe("a code two facts share", () => {
  it("is said the way each fact means it", () => {
    expect(factWords("filing_status", "single")).toBe("single");
    expect(choiceWords("single", "filing_status")).toBe("single");
    expect(factWords("household", "single")).toBe("just you");
    expect(choiceWords("single", "household")).toBe("just you");
  });

  it("keeps the shared words for a fact with none of its own", () => {
    expect(factWords("filing_status", "married_joint")).toBe("married, filing jointly");
    expect(choiceWords("eats_out")).toBe("mostly out");
  });
});
