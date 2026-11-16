import { describe, expect, it } from "vitest";
import type { CardInterest } from "@/lib/card-interest";
import { cardInterestReply } from "./card-interest-replies";

// Debugger 11-16 (an uploaded checking and Chase card): "how much interest am I paying on my credit
// card?" got "Cutting card interest needs a lending partner, and there isn't one for your accounts
// yet." from someone who had paid $84.81 in three months. No real account has a lending partner, so
// the answer comes from the card interest Jane found, with the finding's own steps.

const noPartner = { available: false, cards: [], promos: [] } as unknown as CardInterest;

describe("card interest without a lending partner", () => {
  it("says what the person paid, and links the steps", () => {
    const reply = cardInterestReply(noPartner, {
      findingId: "f1",
      title: "$84.81 in interest on Chase card in the last 3 months",
      yearlyCents: 33_924,
    });
    expect(reply.body).toBe(
      "You paid $84.81 in interest on Chase card in the last 3 months, about $339.24 a year. Paying the balance off ends it; until then, asking the card company for a lower rate cuts it.",
    );
    expect(reply.actions).toEqual([
      expect.objectContaining({ label: "Show me how", href: "/report/f1" }),
    ]);
  });

  it("says so when there's no card interest", () => {
    expect(cardInterestReply(noPartner, null).body).toBe(
      "I don't see any card interest in your accounts. Paying each card in full every month keeps it that way.",
    );
  });
});
