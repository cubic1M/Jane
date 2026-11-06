import { describe, expect, it } from "vitest";
import { checkGuardrails, splitByGuardrails } from "@/lib/guardrails";

// Security round 48: #1549 kept a real account's reshop from saying it saves, calling a rival
// cheaper or saying to switch, but only on a card whose finding is a reshop, and only for its exact
// phrases. The chat names no finding, so Claude could still tell a real account to cancel GEICO
// and go with State Farm (connectors roadmap round 14, 4.3: CA CIC 790.03, NAIC Model 880).
const blocked = (text: string) => {
  const check = checkGuardrails(text, []);
  return !check.ok && check.issues.includes("insurance_comparison");
};

describe("the chat steering a real account off its policy", () => {
  it.each([
    "Switch to Progressive; it's cheaper.",
    "Cancel your GEICO policy and go with State Farm.",
    "Progressive is cheaper than GEICO for you.",
    "Drop GEICO.",
    "You should switch insurers.",
    "Get a quote from Progressive and switch.",
    "Your car insurance went up, so switch carriers today.",
    "Lemonade would cost you $12 less a month for renters insurance.",
    "You could save by moving to Allstate.",
  ])("stops %j", (text) => {
    expect(blocked(text)).toBe(true);
  });

  it("drops just that sentence from an answer", () => {
    const split = splitByGuardrails(
      "Your GEICO premium is $152.00 a month. Switch to Progressive; it's cheaper.",
      [15_200],
    );
    expect(split.kept).toEqual(["Your GEICO premium is $152.00 a month."]);
  });

  it("finds the reshop's own words in any sentence of a reshop card", () => {
    expect(
      checkGuardrails("Rates went up. It's a better deal elsewhere.", [], "insurance_reshop"),
    ).toEqual({ ok: false, issues: ["insurance_comparison"] });
  });

  it.each([
    // What Jane does say about a reshop.
    "Compare quotes for the same coverage, and keep your current policy until a new one starts.",
    "Don't cancel your policy until the new one starts.",
    "Your GEICO premium went up 12% at renewal.",
    "You switched to GEICO in March.",
    // Other bills, in an answer that also mentions insurance.
    "Switch to T-Mobile; it's cheaper. Your car insurance is $152.00 a month.",
    "Cancel Netflix to save $15.49 a month.",
    "Moving to a new state can change your car insurance premium.",
    // The person's own letter.
    "Please cancel my GEICO policy as of November 30.",
  ])("lets %j through", (text) => {
    expect(blocked(text)).toBe(false);
  });

  it("leaves demo advice and other findings alone", () => {
    expect(
      checkGuardrails("Switch to Progressive; it's cheaper.", [], undefined, "demo_advice"),
    ).toEqual({
      ok: true,
    });
    expect(checkGuardrails("A cheaper plan exists.", [], "price_increase")).toEqual({ ok: true });
  });
});
