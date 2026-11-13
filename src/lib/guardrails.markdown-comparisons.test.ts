import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";
import { GuardedText } from "./jane-agent/guarded-text";

// Chat policy round 19 (11-13): bold, italics or code around a pick, a pick put as a comparison or
// a question, ignoring a lawsuit or letting a debt charge off, and a promised approval.
const amounts = [1549, 145000, 12000, 1799, 21588, 9600];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("a pick on a real account", () => {
  it.each([
    "Buy **TSLA**.",
    "**Buy** TSLA.",
    "Buy `VOO` today.",
    "Buy _VTI_ every month.",
    "Buy Tesla (TSLA).",
    "My top pick: VOO.",
    "If I were you, VOO.",
    "VOO beats VTI for you.",
    "VOO > VTI for someone like you.",
    "Have you considered putting it in VTI?",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "Your **Netflix** charge is $15.49.",
    "Your top bill is **Rent** at $1,450.00.",
    "Hulu is $17.99 a month, $215.88 a year. My pick: Hulu with ads, which saves about $96.00 in the first year.",
    "Move it into a HYSA to earn more.",
    "If I were you, I would cancel Hulu.",
    "ACH over wire is cheaper.",
    "* Netflix: $15.49",
    "snake_case_name and 2*3 and _underscored_",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });

  it("streams no bold pick", () => {
    let screen = "";
    const guarded = new GuardedText(
      () => amounts,
      (text) => (screen += text),
    );
    for (const chunk of ["Your **Netflix** charge is $15.49. ", "Buy **TS", "LA** now."]) {
      guarded.push(chunk);
    }
    guarded.finish();
    expect(screen).toBe("Your **Netflix** charge is $15.49.");
  });
});

describe("a lawsuit, a charge-off and a promised approval, on any account", () => {
  it.each([
    "Don't answer the court papers.",
    "Let it charge off and settle later.",
    "You'll be approved for the loan.",
    "You'll qualify for the lower rate.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "You have a court date? I can't help with that, a lawyer can.",
    "Why not cancel Hulu? You haven't used it since August.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
