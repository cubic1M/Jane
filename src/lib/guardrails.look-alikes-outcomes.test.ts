import { describe, expect, it } from "vitest";
import { checkGuardrails, isAdvice } from "./guardrails";
import { GuardedText } from "./jane-agent/guarded-text";

// Chat policy round 18 (11-13): letters that look like others, what someone can't do to you by
// law, money called a gift to dodge tax, a promised credit score, and investing in Russian, Hindi,
// Arabic, Dutch, Polish and Turkish.
const amounts = [3500, 41000, 145000, 20000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("a pick in letters that look like others, on a real account", () => {
  it.each(["ＢＵＹ ＴＳＬＡ now.", "Buy T​SLA now.", "Buy ТSLA now.", "Invest­in an index fund."])(
    "stops %s",
    (text) => {
      expect(real(text).ok).toBe(false);
      expect(isAdvice(text)).toBe(true);
    },
  );

  it.each([
    "Акции в магазине до пятницы.",
    "Café Ольга charged $35.00.",
    "家賃は＄１，４５０．００です。",
    "Netflix…Hulu… and more.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });

  it("finds a full-width figure nothing supports", () => {
    expect(real("家賃は＄９，９９９．００です。")).toEqual({
      ok: false,
      issues: ["unsupported_dollar_figure"],
    });
  });
});

describe("investing in more languages, on a real account", () => {
  it.each([
    "Купите акции Tesla.",
    "Инвестируйте в индексный фонд.",
    "शेयर खरीदें।",
    "निवेश करें।",
    "اشترِ أسهم تسلا.",
    "Koop aandelen Tesla.",
    "Kup akcje Tesli.",
    "Hisse senedi alın.",
    "Short the market before the Fed meeting.",
    "Go long on Nvidia.",
    "Let your winners ride.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each(["शेयर करें।", "Your car payment is $410.00 on the 5th."])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("legal outcomes, gifts to dodge tax and a promised score, on any account", () => {
  it.each([
    "They can't garnish your wages for that.",
    "Your landlord can't evict you for that.",
    "They can't take your car.",
    "Call it a gift so it isn't taxed.",
    "Report it as a gift instead of income.",
    "This will raise your credit score by 50 points.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "They can't see your password.",
    "The landlord can't be reached by phone.",
    "You sent $200.00 to your sister as a gift.",
    "Paying on time could help your score.",
    "Your score dropped by 20 points.",
    "This will take about 5 minutes.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});

describe("the streamed answer", () => {
  it("never shows a pick written in look-alike letters", () => {
    let screen = "";
    const guarded = new GuardedText(
      () => amounts,
      (text) => (screen += text),
    );
    for (const chunk of [
      "Your rent is $1,450.00. ",
      "ＢＵＹ ",
      "ＴＳＬＡ now. ",
      "Buy T​",
      "SLA.",
    ]) {
      guarded.push(chunk);
    }
    guarded.finish();
    expect(screen).toBe("Your rent is $1,450.00.");
    expect(guarded.stoppedEarly()).toBe(true);
  });
});
