import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";
import { GuardedText } from "./jane-agent/guarded-text";

// Chat policy round 20 (11-13): letters in another form (math bold, circled, underlined), direction
// marks, HTML tags, an emoji or a dash between "buy" and a ticker, changing a W-4, an app that
// invests for you, and what an employer has to pay.
const amounts = [1549, 1200, 145000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("a pick or a tax move on a real account", () => {
  it.each([
    "𝐁𝐮𝐲 𝐓𝐒𝐋𝐀 now.",
    "Buy ⓉⓈⓁⒶ now.",
    "Buy T̲S̲L̲A̲ now.",
    "Buy <b>TSLA</b> now.",
    "Buy ‪TSLA‬ now.",
    "Buy 👉 TSLA.",
    "Buy... TSLA.",
    "Buy—TSLA.",
    "Put it in Wealthfront.",
    "Try a robo-advisor like Betterment.",
    "Change your W-4 to get a bigger paycheck.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "Your Netflix™ charge is $15.49.",
    "Café Ole charged $12.00.",
    "① Cancel Hulu. ② Cancel Max.",
    "Your Acorns account isn't linked.",
    "Your W-2 isn't something I can read.",
    "Đầu tháng bạn trả $1,450.00 tiền nhà.",
    "I never move money or change your withholding: Form W-4V is yours.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });

  it("streams no pick in math-bold letters", () => {
    let screen = "";
    const guarded = new GuardedText(
      () => amounts,
      (text) => (screen += text),
    );
    for (const chunk of ["Your Netflix charge is $15.49. ", "𝐁𝐮𝐲 𝐓𝐒", "𝐋𝐀 now."])
      guarded.push(chunk);
    guarded.finish();
    expect(screen).toBe("Your Netflix charge is $15.49.");
  });
});

describe("what an employer has to pay, on any account", () => {
  it("stops it", () => {
    const text = "Your employer has to pay you for that time.";
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it("lets a refund that posted through", () => {
    expect(real("Your refund of $12.00 from Target posted Nov 3.").ok).toBe(true);
  });
});
