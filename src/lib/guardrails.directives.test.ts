import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// What a real account's chat answer could say with no word the lists knew (audit, 11-04). Until now
// only the prompt stopped these, and what code allows can't depend on Claude having listened.
const issues = (text: string) => {
  const check = checkGuardrails(text, [20_000]);
  return check.ok ? [] : check.issues;
};

describe("plain instructions in a chat answer", () => {
  it.each([
    ["You should buy Tesla now.", "investment_advice"],
    ["Sell Tesla today.", "investment_advice"],
    ["Put the extra in VOO.", "investment_advice"],
    ["Max out your HSA this year.", "investment_advice"],
    ["You should fund your 529 first.", "investment_advice"],
    ["Withhold your rent until they fix it.", "tax_or_legal_advice"],
    ["Stop paying rent until the landlord replies.", "tax_or_legal_advice"],
    ["I can't file this for you, but deduct the home office.", "tax_or_legal_advice"],
    [
      "I can't file this for you, but you can claim the home office as a loss.",
      "tax_or_legal_advice",
    ],
  ])("stops %s", (text, issue) => {
    expect(issues(text)).toContain(issue);
  });

  it.each([
    "Buy Costco gas instead of the station by your office.",
    "You could sell the old couch.",
    "Put the $200.00 in PNC savings.",
    "Put it in USAA.",
    "Your HSA holds $200.00.",
    "You put $200.00 into your HSA in March.",
    "You stopped paying rent to Oak Street in June.",
    "Your rent is $200.00 this month.",
    "I can't help hide income from the IRS, but I can show you what came in.",
  ])("leaves %s alone", (text) => {
    expect(issues(text)).toEqual([]);
  });
});
