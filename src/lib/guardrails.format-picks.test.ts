import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// A pick the guardrail stops in plain words, written another way: a list item, a verdict after a
// dash, shouted, or a fund's ticker written small. On a real account (the standard profile) these
// stop under Anthropic's Usage Policy from Nov 12, 2026. The chat's twelfth round (11-12) found
// these got through.
const advice = (text: string) => {
  const check = checkGuardrails(text, [50_000], undefined, "standard");
  return !check.ok && check.issues.includes("investment_advice");
};

describe("a pick written another way, on a real account", () => {
  it.each([
    "- Sell Tesla\n- Keep the cash",
    "- Buy Apple\n- Pay the card",
    "Here's my take: Tesla — sell.",
    "VTI: buy.",
    "SELL TESLA NOW.",
    "Buy voo now.",
    "Put it in vti.",
    "I'd go with qqq.",
  ])("stops %j", (text) => {
    expect(advice(text)).toBe(true);
  });

  it.each([
    // A simulated strategy's own rule, labelled so (src/lib/paper/wording.ts).
    "Your strategy's rule: buy $500.00 of VTI. On your simulated account.",
    "BUY NOW, PAY LATER plans: you have 2 open.",
    "Yes — buy it.",
    "- Netflix\n- Hulu",
    "Your Sony TV — paid off in March.",
    "The spy camera was $50.00.",
  ])("lets %j through", (text) => {
    expect(advice(text)).toBe(false);
  });
});
