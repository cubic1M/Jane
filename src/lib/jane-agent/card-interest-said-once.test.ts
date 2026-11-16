import { describe, expect, it } from "vitest";
import type { CardInterest } from "@/lib/card-interest";
import { cardInterestReply } from "./card-interest-replies";

// Debug 2 (11-15, 14 months of statements with a Capital One card, 1280 light): "how much interest
// am I paying on my credit card?" got "You paid $353.31 in interest on Capital One card in the
// last 12 months, about $353.31 a year." With a year of interest seen, the yearly figure is the
// same number: it's said once. With less than a year, the year's pace still follows.

const noPartner = { available: false, cards: [], promos: [] } as unknown as CardInterest;

describe("card interest seen over a whole year", () => {
  it("says the figure once", () => {
    const reply = cardInterestReply(noPartner, {
      findingId: "f1",
      title: "$353.31 in interest on Capital One card in the last 12 months",
      yearlyCents: 35_331,
    });
    expect(reply.body).toBe(
      "You paid $353.31 in interest on Capital One card in the last 12 months. Paying the balance off ends it; until then, asking the card company for a lower rate cuts it.",
    );
  });
});
