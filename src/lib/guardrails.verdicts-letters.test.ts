import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 13 (11-12): picks written as a verdict, an arrow or an emoji, a stock written
// small, a mutual fund in capitals, the employer match, a tax extension and legal letters.
const amounts = [4200, 3500, 1995, 145000, 5000, 50000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("picks and moves on a real account", () => {
  it.each([
    "Worth looking at: VTSAX.",
    "I'd go with Fidelity's FXAIX.",
    "📈 TSLA 🚀",
    "Tesla → sell",
    "Apple: strong buy.",
    "Tesla's a hold for now.",
    "NVDA is the move.",
    "Dump your tsla.",
    "HODL your coins.",
    "Take the employer match — it's free money.",
    "File an extension.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "You spent $42.00 at FedEx last month.",
    "Your ROLEX repair was $500.00.",
    "Call 1-800-555-0100 and ask for extension 4.",
    "Your employer deposits $1,450.00 every two weeks.",
    "Your Apple One plan is $19.95 a month.",
    "The $35.00 charge is a hold, not a payment.",
    "Your strategy's rule: buy $500.00 of VTI. On your simulated account.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("legal letters on any account", () => {
  it.each([
    "Send them a cease and desist letter.",
    "Send a demand letter for your deposit.",
    "Write to the collector; they have to stop contacting you.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each(["Send Netflix a message to cancel.", "Dispute the $35.00 charge with your bank."])(
    "lets %s through",
    (text) => {
      expect(real(text).ok).toBe(true);
    },
  );
});
