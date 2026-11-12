import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 11 (11-12): Jane answers in the person's language, and advice in Spanish,
// French, German or Chinese passed every English rule. So did a call on the market, a tax credit
// someone "qualifies for" and legal claims about a fee or a contract.
const amounts = [500000, 120000, 1549, 3500, 420, 698000, 740000, 42000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("investing in another language, on a real account", () => {
  it.each([
    "Compra acciones de Tesla ahora.",
    "Vende tus acciones de Apple.",
    "Invierte los $5,000.00 en un fondo indexado.",
    "Achète des actions Tesla.",
    "Investis $5,000.00 en bourse.",
    "Kauf Aktien von Apple.",
    "Invista em ações da Petrobras.",
    "把 $5,000.00 买入指数基金。",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  // The lang- scenarios' answers (src/lib/jane-agent/checks/recorded-answers.json).
  it.each([
    "Claro, te ayudo. Ahora mismo tienes $6,980.00 disponibles para gastar hasta el 1 de nov (en 11 días), con $7,400.00 en tu cuenta y $420.00 en facturas próximas.",
    "Tu suscripción de Netflix cuesta $15.49 al mes.",
    "Tus acciones en la app: cancelar o pausar.",
    "Fais une demande de remboursement de $35.00 à ta banque.",
    "你的支票账户现在有 $420.00。",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});

describe("legal claims, in any language and on any account", () => {
  it.each([
    "Puedes demandarlos en la corte de reclamos menores.",
    "Tu peux les poursuivre en justice.",
    "Du kannst sie verklagen.",
    "你可以起诉他们。",
    "That fee is illegal in California.",
    "They can't charge you that fee; it's against the law.",
    "Your employer owes you overtime for those hours.",
    "That's wage theft.",
    "The contract is void, so you don't owe it.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each(["Your rent is $420.00 a week.", "The late fee was $35.00 on Nov 3."])(
    "lets %s through",
    (text) => {
      expect(real(text).ok).toBe(true);
    },
  );
});

describe("market calls and tax credits, on a real account", () => {
  it.each([
    "The market is due for a correction; stay in cash.",
    "Stocks are about to rally, so don't sell.",
    "You qualify for the EITC this year.",
    "You'd be eligible for the Saver's Credit.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "You spent $1,200.00 at the market last month.",
    "Keep $5,000.00 in savings for emergencies.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
