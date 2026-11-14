import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 27 (11-14): owing no tax, what the law allows or protects, a promised score,
// a sure thing, and Bengali, Urdu, Persian and Hungarian picks.
const amounts = [9000, 1549, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("tax and picks on a real account", () => {
  it.each([
    "You owe no tax on that.",
    "You won't pay any federal tax on it.",
    "শেয়ার কিনুন",
    "سرمایہ کاری کریں",
    "سرمایه گذاری کنید",
    "سرمایه‌گذاری کنید",
    "Fektess be részvényekbe.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each(["Your tax refund of $90.00 landed Nov 3.", "You paid $15.49 in sales tax last month."])(
    "lets %s through",
    (text) => {
      expect(real(text).ok).toBe(true);
    },
  );
});

describe("legal advice and promises, demo included", () => {
  it.each([
    "It's legal to record the call in your state.",
    "You can't be fired for that.",
    "They can't be held liable.",
    "Your co-signer isn't liable.",
    "Your score will be 750 by spring.",
    "This is a sure thing.",
    "It's a sure bet.",
    "Zero risk.",
    "You can't go wrong with this.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "There's no such thing as a sure bet.",
    "Nothing's a sure thing.",
    "Your liability coverage is $90.00 a month.",
    "Your score isn't linked yet.",
    "Zero fees on this account so far.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});
