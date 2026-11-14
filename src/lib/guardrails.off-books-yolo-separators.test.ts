import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 23 (11-13): paying or earning off the books, what a landlord can't do, ignoring a
// summons, "can't lose", YOLO and aping in, tickers split by other marks, Swahili, Hebrew and Greek.
const amounts = [5000, 1000, 400000, 60000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("legal claims and promises, on any account", () => {
  it.each([
    "Pay your nanny under the table.",
    "Don't report the cash tips.",
    "They can't raise your rent more than 5%.",
    "You can ignore the jury summons.",
    "You can't lose with this.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "Pay your nanny $600.00 on Friday.",
    "Your cash tips came to $600.00.",
    "Your rent went up 5% this year.",
    "Your plan is risk-free to cancel anytime.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});

describe("investing on a real account", () => {
  it.each([
    "YOLO it into calls.",
    "Ape into GME.",
    "Buy V‐O‐O.",
    "Buy V/O/O.",
    "Buy V_O_O.",
    "Buy V·O·O.",
    "Buy V–O–O.",
    "Wekeza kwenye hisa.",
    "השקע במניות.",
    "Επένδυσε σε μετοχές.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });

  it.each([
    "Your Microsoft 365 bill is $10.00 a month.",
    "Your 80/20 budget split is on track.",
    "Move 20% of your paycheck to savings.",
    "Your Wi-Fi bill w/o the router is $50.00.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
