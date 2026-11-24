import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// "Why did I pay $100 to Vercel?" wordings (founder 11-24), and the neighbours that must not move.

const AS_OF = "2026-11-23";

describe("charge_explain", () => {
  it.each([
    ["why did I pay $100 to Vercel", "vercel", 10_000, null, false],
    ["Why did I pay $100 to Vercel on Nov 20?", "vercel", 10_000, "2026-11-20", false],
    ["why did i pay vercel $100", "vercel", 10_000, null, false],
    ["why am I paying $100 to Vercel", "vercel", 10_000, null, false],
    ["why was I charged $100 by Vercel", "vercel", 10_000, null, false],
    ["why was I charged so much by Vercel", "vercel", null, null, true],
    ["why did Vercel charge me $100", "vercel", 10_000, null, false],
    ["why did Vercel charge me so much", "vercel", null, null, true],
    ["why was Vercel so high", "vercel", null, null, true],
    ["why was my Vercel bill so high this month", "vercel", null, null, true],
    ["why is my Vercel bill higher this month", "vercel", null, null, true],
    ["what is this $100 Vercel charge", "vercel", 10_000, null, false],
    ["what is this Vercel charge", "vercel", null, null, false],
    ["what's the $100 charge from Vercel", "vercel", 10_000, null, false],
    ["why was I charged for netflix", "netflix", null, null, false],
    // A prefix after the verb comes off ("my" isn't part of the name).
    ["why did I pay my Netflix bill", "netflix", null, null, false],
    ["why did I pay the Vercel invoice", "vercel", null, null, false],
    ["why did Chase charge me $34", "chase", 3_400, null, false],
  ])("%s", (question, target, amountCents, day, high) => {
    expect(parseIntent(question, AS_OF)).toEqual({
      kind: "charge_explain",
      target,
      amountCents,
      day,
      high,
    });
  });

  // "Apr" with a day is April, not an APR (CodeRabbit's example).
  it("reads 'Apr 20' as a date, not as APR", () => {
    expect(parseIntent("why did I pay $100 to Vercel on Apr 20", AS_OF)).toEqual({
      kind: "charge_explain",
      target: "vercel",
      amountCents: 10_000,
      day: "2026-04-20",
      high: false,
    });
  });

  it("keeps real APR questions with the interest handling", () => {
    for (const q of ["why is my apr so high", "why did Chase charge me a high apr"]) {
      expect(parseIntent(q, AS_OF).kind, q).not.toBe("charge_explain");
    }
  });

  it.each([
    ["why did Vercel go up", "vercel"],
    ["why did my Netflix go up", "netflix"],
  ])("%s", (question, target) => {
    expect(parseIntent(question, AS_OF)).toEqual({
      kind: "charge_explain",
      target,
      amountCents: null,
      day: null,
      high: false,
      up: true,
    });
  });

  it.each([
    // No name: the amount's own answer.
    ["why was I charged $34", "charge_amount"],
    ["why am i paying $12 every month", "charge_amount"],
    ["What was the $14 Nelnet charge?", "charge_amount"],
    ["what is this $12 fee", "fee_why"],
    // A fee or interest anywhere in the question is the fee's answer, whoever charged it.
    ["why did Chase charge me $34 in overdraft fees", "fee_why"],
    ["why did Chase charge me an overdraft fee", "fee_why"],
    ["why did I pay $12 in fees to Chase", "charge_amount"],
    ["why did I pay interest on my Chase card", "card_interest"],
    // A bank fee is the fee's answer.
    ["why was I charged a maintenance fee", "fee_why"],
    ["why am I paying fees at Bank of America?", "fee_why"],
    // The charge's own story, and when a price went up.
    ["what was the Nelnet charge", "charge_story"],
    ["What happened with the Amazon charge?", "charge_story"],
    // The mortgage's and insurance's questions are theirs, whatever the wording.
    ["why did my escrow go up", "mortgage"],
    ["when did Hulu go up", "price_change"],
    ["how much did Hulu go up", "price_change"],
  ])("%s stays %s", (question, kind) => {
    expect(parseIntent(question, AS_OF).kind).toBe(kind);
  });
});
