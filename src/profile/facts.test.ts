import { describe, expect, it } from "vitest";
import { choiceWords, factSpec, factWords } from "./facts";

// Debugger 11-02: /profile read "eats_out" and "Your mortgage rate (in basis points)".
describe("how a fact reads", () => {
  it("says a choice in words", () => {
    // In words, not the stored code (src/lib/memory/plain-words.test.ts).
    expect(choiceWords("eats_out")).toBe("mostly out");
    expect(factWords("eating_style", "eats_out")).toBe("mostly out");
    expect(factWords("eating_style", "cooks")).toBe("mostly at home");
  });

  it("says a mortgage rate as a rate", () => {
    expect(factWords("mortgage_rate_bps", 650)).toBe("6.50%");
    expect(factSpec("mortgage_rate_bps")?.label).toBe("Your mortgage rate");
  });

  it("leaves everything else as it was", () => {
    expect(factWords("county", "Multnomah")).toBe("Multnomah");
    expect(factWords("earners", 2)).toBe("2");
  });
});
