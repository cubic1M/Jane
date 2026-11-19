import { describe, expect, it } from "vitest";
import { onePlurals } from "./invariants";

// The one-plural rule (class 2, debug3-invariants.md) on what the walkers found, and on figures
// and words that only look like it.

const one = (text: string) => onePlurals({ "home.summary.sub": text });

describe("a count of one", () => {
  it("is caught with a plural noun", () => {
    expect(one("Based on 1 months of data")).toHaveLength(1);
    expect(one("You paid 1 late fees this year")).toHaveLength(1);
    expect(one("1 urgent · 1 things to look at")).toHaveLength(1);
    expect(one("1 is due")).toEqual([]);
    expect(one("1 bill renews on Nov 3")).toEqual([]);
  });

  it("is let be in the singular, in figures, and before a word ending in s", () => {
    for (const text of [
      "Based on 1 month of data",
      "1 late fee",
      "$1 fees",
      "1.5 years",
      "11 months",
      "1 bonus",
      "Nov 1 payments",
    ]) {
      expect(one(text), text).toEqual([]);
    }
  });
});
