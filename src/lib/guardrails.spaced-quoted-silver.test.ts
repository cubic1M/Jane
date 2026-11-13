import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";
import { GuardedText } from "./jane-agent/guarded-text";

// Chat policy round 22 (11-13): a ticker in quotes or with its letters spaced out, stacking silver,
// Ukrainian and Thai, and what a landlord "must" return.
const amounts = [500000, 9000, 5000, 190000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("investing on a real account", () => {
  it.each([
    'Buy "VOO".',
    "Buy “VOO” this week.",
    "B U Y  V O O",
    "b.u.y. v.o.o",
    "Stack silver every month.",
    "Keep stacking gold.",
    "Інвестуй у акції.",
    "ลงทุนในหุ้น",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    'Your "Netflix" charge was $90.00.',
    "Your Gold's Gym membership is $50.00 a month.",
    "Your T-Mobile bill was $90.00.",
    "Move $5,000.00 to savings, e.g. the one at Ally.",
    "Your U.S. Bank card ends in 4411.",
    "Put it in savings.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });

  it("stops a spaced-out ticker as it streams", () => {
    let screen = "";
    const guarded = new GuardedText(
      () => amounts,
      (text) => (screen += text),
    );
    guarded.push("Your rent is covered. ");
    guarded.push("B U Y  V O O and hold it.");
    guarded.finish();
    expect(guarded.stoppedEarly()).toBe(true);
    expect(screen).not.toContain("V O O");
  });
});

describe("legal rights on any account", () => {
  it.each([
    "Your landlord must return your deposit within 21 days.",
    "Your employer legally must pay you for that time.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it("lets a deposit fact through", () => {
    expect(real("Your rent of $1,900.00 is due Nov 1.").ok).toBe(true);
  });
});
