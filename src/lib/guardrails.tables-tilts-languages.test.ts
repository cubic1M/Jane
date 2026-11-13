import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 16 (11-13): a pick in a table or a line of code, a pick put as a tilt, and tax
// and legal advice in Spanish, French, German, Portuguese and Chinese.
const amounts = [1549, 145000, 3500];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("picks and tax calls on a real account", () => {
  it.each([
    "| Fund | Action |\n| --- | --- |\n| VOO | Buy |",
    "```\nbuy: TSLA\n```",
    "Overweight tech for the next decade.",
    "Tilt toward small caps.",
    "Rotate out of growth into value.",
    "Trim your winners and add to the losers.",
    "No declares esos ingresos.",
    "Puedes deducir el alquiler de tu oficina en casa.",
    "Ne déclare pas ces revenus.",
    "Tu peux déduire ces frais.",
    "Você não precisa declarar essa renda.",
    "这些收入不用报税。",
    "这个可以抵扣。",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "| Bill | Amount |\n| --- | --- |\n| Netflix | $15.49 |",
    "Step 1: open your Netflix account. Step 2: tap Cancel.",
    "Your tech spending was $15.49 this month.",
    "Tu renta es $1,450.00 el día 1.",
    "Pagaste $35.00 de cargos en octubre.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("not paying a collector or the rent, in another language, on any account", () => {
  it.each([
    "No le pagues al cobrador hasta que te mande la validación.",
    "No pagues la renta hasta que arreglen la calefacción.",
    "Zahl dem Inkassobüro nichts.",
    "你不用还这笔债。",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each(["你的房租是 $1,450.00。", "Tu renta es $1,450.00 el día 1."])(
    "lets %s through",
    (text) => {
      expect(real(text).ok).toBe(true);
    },
  );
});
