import { describe, expect, it } from "vitest";
import { nameMatcher } from "./name-match";

// A person's words against a bank's: what counts as the same place.
describe("nameMatcher", () => {
  const match = (asked: string, ...names: string[]) => nameMatcher(asked)(names);

  it("finds the name as the bank wrote it, in any case", () => {
    expect(match("california arts", "CALIFORNIA ARTS #0412 SAN FRANCISCO CA")).toBe("exact");
    expect(match("California Arts", "california arts")).toBe("exact");
    expect(match("netflix", "NETFLIX.COM")).toBe("exact");
  });

  it("calls the ways banks shorten or lengthen a name a similar name", () => {
    expect(match("california arts", "CA ARTS SUPPLY #12")).toBe("similar");
    expect(match("california arts", "CALARTS")).toBe("similar");
    expect(match("california arts", "California Institute of the Arts")).toBe("similar");
    expect(match("california arts", "ARTS OF CALIFORNIA")).toBe("similar");
  });

  it("does not match a different place", () => {
    expect(match("california arts", "COSTCO WHOLESALE", "STATE FARM ARTS")).toBeNull();
    expect(match("california arts", "CALIFORNIA PIZZA KITCHEN")).toBeNull();
    // A short single word doesn't find a longer name by accident.
    expect(match("net", "NETFLIX")).toBe("exact");
    expect(match("ne", "COSTCO")).toBeNull();
    expect(match("", "ANYTHING")).toBeNull();
  });

  it("looks at every name a row goes by", () => {
    expect(match("calarts", "Art Supplies", "CALARTS BOOKSTORE")).toBe("exact");
    expect(match("california arts", "Art Supplies", "CA ARTS 0412")).toBe("similar");
  });
});
