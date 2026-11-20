import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// What they make, asked of the backup chat: the walkers' "how much do I make a month?" and "a
// year?" were left unanswered on every phone pass from the fifth (walk notes, 11-18 to 11-20).

const AS_OF = "2026-11-20";

describe("asking what you make", () => {
  it.each([
    "How much do I make a month?",
    "how much do i earn per month",
    "what's my monthly income",
    "What is my income?",
    "how much do I take home",
    "how much money comes in each month",
  ])("reads %s as a month's income", (q) => {
    expect(parseIntent(q, AS_OF)).toEqual({ kind: "income", period: "month" });
  });

  it.each([
    "How much do I make a year?",
    "what's my yearly income",
    "my annual income",
    "how much did I earn this year",
  ])("reads %s as a year's", (q) => {
    expect(parseIntent(q, AS_OF)).toEqual({ kind: "income", period: "year" });
  });

  it.each(["when do I get paid", "how much is my paycheck", "how much tax do I owe on my income"])(
    "leaves %s to its own answer",
    (q) => {
      expect(parseIntent(q, AS_OF).kind).not.toBe("income");
    },
  );
});
