import { describe, expect, it } from "vitest";
import type { CardInterest } from "@/lib/card-interest";
import { cardInterestReply } from "./card-interest-replies";

// CodeRabbit part 2: a card whose balance or rate isn't known is not a card with no interest, and
// the interest a lender reports is said beside the cards' own.

const available = (over: Partial<CardInterest>) =>
  ({
    available: true,
    cards: [],
    promos: [],
    unknownCardIds: [],
    interestYearCents: 0,
    grantedSavingCents: 0,
    requests: [],
    ...over,
  }) as unknown as CardInterest;

describe("card interest with a card that isn't known", () => {
  it("does not say there is none", () => {
    const reply = cardInterestReply(available({ unknownCardIds: ["a1"] }));
    expect(reply.body).not.toMatch(/None of your cards/);
    expect(reply.body).toMatch(/can't see the balance or the rate on one of your cards/);
  });

  it("still says none when every card is known", () => {
    expect(cardInterestReply(available({})).body).toMatch(/None of your cards/);
  });

  it("says what a lender reports even when the cards have an answer", () => {
    const reply = cardInterestReply(available({}), null, [{ name: "Navient", ytdCents: 311_950 }]);
    expect(reply.body).toContain("$3,119.50 on Navient");
  });
});
