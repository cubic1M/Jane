import { describe, expect, it } from "vitest";
import { normalize } from "../intents";
import { parseInsurance } from "./intents";

// Spec step 199: the amount and what happened are read from the question.

describe("claim or pay yourself", () => {
  it.each([
    ["is it worth claiming a $1,200 repair on my car", 120_000],
    ["should I file a claim for $450 of damage", 45_000],
    ["worth making a claim for 2500 dollars", 250_000],
  ])("reads %s", (text, cents) => {
    const intent = parseInsurance(normalize(text));
    expect(intent?.ask).toBe("claim_worth");
    expect(intent?.amountCents).toBe(cents);
  });

  it("asks without an amount", () => {
    expect(parseInsurance("is it worth making a claim")?.ask).toBe("claim_worth");
  });
});
