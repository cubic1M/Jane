import { describe, expect, it } from "vitest";
import { shortLabel } from "./tree";

// Debug 2, sixth desktop sweep (11-18, Plaid sandbox checking + loans): the Taxes tree listed
// "Check the student loan interest, save · $106/yr": a new suggestion with no label of its own was
// labelled from its headline, cut at six words in the middle of "save $106 a year". The worth is the
// node's figure, so the label stops before it.
describe("a node's label from a suggestion's headline", () => {
  it("leaves out what it's worth", () => {
    expect(shortLabel("Check the student loan interest, save $106 a year")).toBe(
      "Check the student loan interest",
    );
    expect(shortLabel("Check California's renter's credit, get $60 back")).toBe(
      "Check California's renter's credit",
    );
    expect(shortLabel("Check tax on your fellowship, avoid up to $1,240")).toBe(
      "Check tax on your fellowship",
    );
  });

  it("keeps a plain name as it was", () => {
    expect(shortLabel("Plaid student ····4000")).toBe("Plaid student ····4000");
  });
});
