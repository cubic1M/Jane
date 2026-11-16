import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 53 (11-16): a right stated, a credit limit predicted, a hard inquiry or a new
// card said not to count, the person's bank said to refund a fee and a company said not to report,
// on any account; a filing status on a real one.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("rights, limit, score and refund claims on any account", () => {
  it.each([
    "You have the right to dispute it.",
    "You've got the right to cancel at any time.",
    "Your credit limit will go up next month.",
    "Your limit will increase soon.",
    "A hard inquiry won't affect your score.",
    "Opening a new card won't hurt your credit score.",
    "Your bank will refund the overdraft fee.",
    "The bank will waive the late fee if you ask.",
    "Your card issuer will lower your APR.",
    "Affirm won't report it to the credit bureaus.",
    "They don't report missed payments to the bureaus.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it("blocks a filing status on a real account", () => {
    expect(real("You should file single.").ok).toBe(false);
    expect(real("File jointly this year.").ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "You have the right to an itemized bill showing each charge and its billing code (CPT or HCPCS).",
    "Your credit card payment of $400.00 posted Nov 1.",
    "Your limit will go up to $90.00 on Dec 1, per Discover's letter.",
    "A soft pull won't affect your score.",
    "This won't affect your credit score.",
    "They'll remove the charge once the refund posts.",
    "Your gym will drop the fee to $5.00 in January, per their email.",
    "Jane doesn't report anything to the credit bureaus.",
    "Ask the bank whether the fee can be reversed.",
    "Ask the store whether they'll take it back.",
    "Your security deposit of $400.00 left checking Nov 1.",
    "Your CFPB complaint link is in your steps.",
  ])("passes %s", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
