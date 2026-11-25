import { describe, expect, it } from "vitest";
import { perYear } from "./helpers";

// CodeRabbit sweep 1b: a deductible card's "up to $X a year" was a rate on the premiums seen in
// however many months of history there were, so one month of a premium read as a year of them.
describe("perYear", () => {
  it("puts premiums seen over some months on a year", () => {
    expect(perYear(60_000, 6)).toBe(120_000);
    expect(perYear(180_000, 18)).toBe(120_000);
    expect(perYear(120_000, 12)).toBe(120_000);
  });
  it("says nothing from under three months of history", () => {
    expect(perYear(15_000, 1)).toBeNull();
    expect(perYear(30_000, 2)).toBeNull();
  });
});
