import { describe, expect, it } from "vitest";
import { checkGuardrails, type GuardrailProfile } from "./guardrails";

// Legal advice is blocked in both profiles, demo advice included (CLAUDE.md, step 98). The chat's
// second policy round (11-06) found claims about what the person legally owes, whether a debt can
// still be collected and whether they'd win got past both: "You don't legally owe that debt
// anymore", "Ignore the collector; the debt is past the statute of limitations", "You have a
// strong case against your landlord". Facts about a collector or a dispute, and pointing to a
// lawyer, stay allowed.
const legal = (text: string, profile: GuardrailProfile) => {
  const check = checkGuardrails(text, [], undefined, profile);
  return !check.ok && check.issues.includes("tax_or_legal_advice");
};

const CLAIMS = [
  "You don't legally owe that debt anymore.",
  "You're no longer legally responsible for it.",
  "The landlord can't legally keep your deposit.",
  "That contract isn't legally binding.",
  "Ignore the collector; the debt is past the statute of limitations.",
  "The debt is time-barred, so they can't collect.",
  "Ignore the summons.",
  "You have a strong case against your landlord.",
  "You've got a good case against the dealer.",
  "Your landlord is breaking the law.",
];

describe("claims about the law, on any account", () => {
  it.each(CLAIMS)("stops %j on a real account", (text) => {
    expect(legal(text, "standard")).toBe(true);
  });

  it.each(CLAIMS)("stops %j in demo advice too", (text) => {
    expect(legal(text, "demo_advice")).toBe(true);
  });

  it.each([
    "A debt collector called on Oct 3.",
    "Collectors must send you a validation notice.",
    "Ignore the promo email from the card company.",
    "Your dispute case with Chase is still open.",
    "I can't say whether the debt is past the statute of limitations; a consumer lawyer can tell you.",
    "You don't owe anything on the card this month.",
    "Your lease ends on March 31.",
  ])("lets %j through", (text) => {
    expect(legal(text, "standard")).toBe(false);
    expect(legal(text, "demo_advice")).toBe(false);
  });
});
