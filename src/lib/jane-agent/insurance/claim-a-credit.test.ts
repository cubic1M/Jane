import { describe, expect, it } from "vitest";
import { parseIntent } from "../intents";

// The chat's fifth policy round (11-06), with Claude refusing so the rules answered on a real
// account: "how do i claim the saver's credit" got "Tell me what happened and I'll show what to
// do now… GEICO car insurance". Any "claim" was an insurance claim. Claiming a credit, a
// deduction, a dependent or a benefit isn't one; something that happened still is.
const AS_OF = "2026-11-06";
const isInsuranceClaim = (text: string) => {
  const i = parseIntent(text, AS_OF) as { kind: string; ask?: string };
  return i.kind === "insurance" && i.ask === "claim";
};

describe("claiming a credit or a benefit isn't an insurance claim", () => {
  it.each([
    "how do i claim the saver's credit",
    "can i claim my son as a dependent",
    "claim unemployment",
    "claim on my taxes",
    "how do i claim the 8880 credit",
  ])("%j", (text) => {
    expect(isInsuranceClaim(text)).toBe(false);
  });

  it.each([
    "i need to file a claim",
    "my car was stolen",
    "how do i make a claim on my renters insurance",
    "file a claim for the hail damage",
  ])("%j is still an insurance claim", (text) => {
    expect(isInsuranceClaim(text)).toBe(true);
  });
});
