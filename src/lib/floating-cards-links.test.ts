import { describe, expect, it } from "vitest";
import { linkOpens } from "./floating-cards";

// Founder (11-12): "when you click open details or open or whatever for the suggestion box, that
// box just disappears and you get sent to the page with the details". A link that only leads to
// details opens the card's own details; every other link goes to its page.
describe("what a card's link opens", () => {
  it("is the card's own details for a link that only leads to them", () => {
    for (const label of [
      "See the details",
      "Details",
      "Open details",
      "More details",
      "Show details",
    ]) {
      expect(linkOpens(label), label).toBe("details");
    }
    expect(linkOpens("  see the details ")).toBe("details");
  });

  it("is the page for anything that goes somewhere", () => {
    for (const label of [
      "Open",
      "Open it",
      "See it",
      "See your insurance",
      "See every debt",
      "Add family details",
      "Review and sign",
    ]) {
      expect(linkOpens(label), label).toBe("page");
    }
  });
});
