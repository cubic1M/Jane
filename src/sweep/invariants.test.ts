import { describe, expect, it } from "vitest";
import { rawLineMarks, rawNames, shownTexts } from "./invariants";

// The raw-name rule (class 1, debug3-invariants.md) on what the walkers found, and on words that
// only look like a bank's line.

describe("a raw bank line, in what a person reads", () => {
  it("is caught by what gives it away", () => {
    expect(rawLineMarks("Target 00012345 $64.20 was charged twice.")).toEqual([
      "a store or terminal number",
    ]);
    expect(rawLineMarks("Trader Joe S #123 $45.50")).toEqual(["a store or terminal number"]);
    expect(rawLineMarks("You pay Sq *Joes Coffee $5.25")).toEqual(["a processor's prefix"]);
    expect(rawLineMarks("Amzn Mktp Us $31.25")).toEqual(["a processor's prefix"]);
    expect(rawLineMarks("You pay Geico Auto Ppd Id: 3334445556")).toContain("an ACH code");
    expect(rawLineMarks("Rent to Online Transfer To Smith J Ref #Ib0x9")).toContain(
      "a bank's transfer wording",
    );
    expect(rawLineMarks("Planet Fitness 800-1234567 $24.99")).toEqual([
      "a customer-service number",
    ]);
    expect(rawLineMarks("VERIZON WIRELESS PAYMENTS is $85.00 a month")).toEqual([
      "a line in capitals",
    ]);
  });

  it("isn't found in ordinary words, money, years or forms", () => {
    for (const text of [
      "Turn on autopay",
      "an overdraft fee on a one-time debit card purchase",
      "You spent $1,977.26 over the next month.",
      'I could start an "Emergency fund" goal: $5,000.00 by November 2027.',
      "The school's Form 1098-T shows what was paid.",
      "7-Eleven $4.20",
      "Your IRS Pub. 970 credit",
      "1 urgent · 4 to look at",
    ]) {
      expect(rawLineMarks(text), text).toEqual([]);
    }
  });
});

describe("what counts as read", () => {
  it("is shown text, never ids, links, the profile's facts or a finding's evidence", () => {
    const flat = {
      "suggestions.cost:duplicate_charge.short": "Target 00012345 $64.20 was charged twice.",
      "suggestions.cost:duplicate_charge.action.href": "/transactions?q=TARGET%2000012345",
      "suggestions.subscriptions:subscriptions.watch.payees.0.description": "PAYPAL *NETFLIX",
      "detected.duplicate_charge:t1.evidence.charges.t1.description": "TARGET 00012345",
      "profile.facts.rent.label": "RENT 00012345",
      "trees.money.summaries.charges:duplicate_charge": "Target 00012345 $64.20 was charged twice.",
    };
    expect(shownTexts(flat).map(([path]) => path)).toEqual([
      "suggestions.cost:duplicate_charge.short",
      "trees.money.summaries.charges:duplicate_charge",
    ]);
    expect(rawNames(flat)).toHaveLength(2);
  });
});
