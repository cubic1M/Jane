import { describe, expect, it } from "vitest";
import { composeAnswer, whatIsAsked, type KnownFacts } from "./auto-answer";

const known: KnownFacts = {
  cardLast4: "4821",
  email: "alex@example.com",
  name: "Alex Rivera",
  charges: [
    { date: "2026-10-15", amountCents: 6_420 },
    { date: "2026-10-16", amountCents: 6_420 },
  ],
};

describe("answering companies' questions", () => {
  it("works out what's asked", () => {
    expect(whatIsAsked("Could you confirm the last 4 digits of the card?")).toEqual({
      kind: "facts",
      facts: ["card_last4"],
    });
    expect(whatIsAsked("What email is on the account, and when were you charged?")).toEqual({
      kind: "facts",
      facts: ["account_email", "charge_dates"],
    });
    expect(whatIsAsked("Please tell us more about the issue.")).toEqual({ kind: "unknown" });
  });

  it("never answers for passwords, PINs, full numbers or identity details", () => {
    for (const q of [
      "Please send the account password.",
      "What is the PIN on the account?",
      "We need the full card number and the security code.",
      "Confirm your date of birth and last 4 digits",
      "Send the one-time code we texted you.",
    ]) {
      expect(whatIsAsked(q)).toEqual({ kind: "never" });
    }
  });

  it("answers only from known facts, and not at all if one is missing", () => {
    expect(composeAnswer(["card_last4"], known)).toBe("The card ends in 4821.");
    expect(composeAnswer(["charge_dates", "charge_amounts"], known)).toBe(
      "The charges were $64.20 on 2026-10-15, $64.20 on 2026-10-16.",
    );
    expect(composeAnswer(["holder_name", "account_email"], known)).toBe(
      "The account holder is Alex Rivera. The account email is alex@example.com.",
    );
    expect(composeAnswer(["card_last4"], { ...known, cardLast4: null })).toBeNull();
    expect(composeAnswer(["card_last4", "holder_name"], { ...known, name: null })).toBeNull();
    // A mask that isn't 4 digits is never passed on.
    expect(composeAnswer(["card_last4"], { ...known, cardLast4: "12345678" })).toBeNull();
  });
});
