import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Advice on a person's own taxes, what to report and how to file, is held for a qualified
// person's review by Anthropic's Usage Policy from Nov 12, 2026. The chat's own audit (11-06)
// found Claude's "Report the Venmo money as hobby income so it's taxed less." shown on a real
// account. The class stops in every profile but demo advice; the facts beside it don't.
const taxAdvice = (text: string) => {
  const check = checkGuardrails(text, []);
  return !check.ok && check.issues.includes("tax_or_legal_advice");
};

describe("what to report and how to file", () => {
  it.each([
    "Report the Venmo money as hobby income so it's taxed less.",
    "Report the Venmo money as hobby income.",
    "Call it hobby income on your return.",
    "That sounds like hobby income, not a business.",
    "List it as self-employment income.",
    "Count the tutoring as side income.",
    "Treat the Etsy sales as business income.",
    "Book it as rental income.",
    "Don't report the cash tips.",
    "You don't need to report the gift money as income.",
    "Just declare the winnings on line 8.",
    "Report your side earnings once they pass $400.",
    "File as head of household this year.",
    "You could file as single and save.",
    "Head of household gets you a bigger standard deduction.",
    "Married filing separately might work out better.",
    "Put the 1099 amount on your return.",
    "Include the crypto sale on your 2026 return.",
    "Claim your daughter as a dependent.",
    "Claim your mom; she lives with you.",
    "You don't have to report it for taxes.",
    "Your taxes go down if you report all of it as business income.",
  ])("stops %j", (text) => {
    expect(taxAdvice(text)).toBe(true);
  });

  it.each([
    "Your bank reported $42.18 of interest for 2026.",
    "Your employer reports your wages on your W-2.",
    "You can report the charge to your card issuer as fraud.",
    "Report it to your bank right away and lock the card.",
    "Report this to the police and your bank.",
    "Your credit report shows two cards and a car loan.",
    "I can't report on cash I don't see.",
    "File a claim with your insurer for your son's ER visit.",
    "File a complaint with the CFPB if they don't answer.",
    "Claim your refund from Amazon in the Orders page.",
    "Claim your son's medical bill with your insurance.",
    "You filed your 2025 return on Apr 2.",
    "Your refund of $1,204.00 came on Mar 3.",
    "The credit comes back with your return.",
    "You earned $4,630.33 a month from Northwind Design.",
    "Your side income was $1,800.00 in October.",
    "Your rental income was $2,100.00 last month.",
    "You're on course to owe about $2,930 in federal tax for 2026.",
    "Venmo sent you $450.00 from Dana on Oct 4.",
    "You list your mom's address as home on the policy.",
    "Your head of maintenance invoice is $120.00.",
    "Your gift card balance is $25.00.",
  ])("lets %j through", (text) => {
    expect(taxAdvice(text)).toBe(false);
  });

  it("still lets demo advice say it, labelled", () => {
    const check = checkGuardrails(
      "File as head of household this year.",
      [],
      undefined,
      "demo_advice",
    );
    expect(check.ok).toBe(true);
  });
});
