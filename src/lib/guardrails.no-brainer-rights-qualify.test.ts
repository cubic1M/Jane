import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 30 (11-14): money thrown at a ticker, a ticker called a no-brainer, being within
// your rights, what collectors can't do, approval promised, six more languages, and going all in on
// paying down a card (allowed).
const amounts = [9000, 1549, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("picks on a real account", () => {
  it.each([
    "Throw $90.00 at VOO each month.",
    "VOO is a no-brainer.",
    "शेयरमा लगानी गर्नुहोस्",
    "Ieguldiet akcijās.",
    "Fjárfestu í hlutabréfum.",
    "Inverteix en accions.",
    "Belê in aandele.",
    "Aksiyalarga sarmoya kiriting.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "Go all in on paying down the card.",
    "Go all in on your emergency fund first.",
    "Throw an extra $90.00 at the card each month.",
    "Put it all in savings.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });

  it("still stops going all in on the market", () => {
    expect(real("Personally, I'd go all in on the S&P.").ok).toBe(false);
    expect(real("Go all in on tech stocks.").ok).toBe(false);
  });
});

describe("legal advice and promises, demo included", () => {
  it.each([
    "You're within your rights to stop paying.",
    "Stop paying; they can't do anything.",
    "Collectors can't touch you.",
    "Approval is certain.",
    "You will qualify.",
    "You'll easily get approved for the card.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "They can't do anything until Monday, so call then.",
    "If your balance stays under $90.00, you'll qualify.",
    "You may qualify for the fee waiver the bank lists.",
    "Your contract renews Dec 1.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});
