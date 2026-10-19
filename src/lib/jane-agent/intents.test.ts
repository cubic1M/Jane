import { describe, expect, it } from "vitest";
import { matchCategory, normalize, parseAmount, parseIntent, parseMonth } from "./intents";

// Spec step 84: the rules that understand what the person typed, with no Claude key. Many
// phrasings of each command, amounts like "$900", "900" and "1.2k", and months.

const TODAY = "2026-10-18";
const parse = (text: string) => parseIntent(text, TODAY);

describe("parseAmount", () => {
  it.each([
    ["can i afford $900", 90_000],
    ["can i afford 900", 90_000],
    ["can i afford $1,200.50", 120_050],
    ["can i afford 1,200", 120_000],
    ["can i afford 1.2k", 120_000],
    ["can i afford $2k", 200_000],
    ["can i afford 3 grand", 300_000],
    ["can i afford 900 dollars", 90_000],
    ["can i afford $ 45.5", 4_550],
    ["can i afford $900 in march 2027", 90_000],
  ])("reads %s", (text, cents) => {
    expect(parseAmount(text)).toBe(cents);
  });

  it("is null without an amount, or for zero", () => {
    expect(parseAmount("can i afford a trip")).toBeNull();
    expect(parseAmount("can i afford $0")).toBeNull();
  });
});

describe("parseMonth", () => {
  it("reads this, next and last month", () => {
    expect(parseMonth("this month", TODAY, "past")).toBe("2026-10");
    expect(parseMonth("next month", TODAY, "future")).toBe("2026-11");
    expect(parseMonth("last month", TODAY, "past")).toBe("2026-09");
  });

  it("takes the next month of that name going forward, the last one looking back", () => {
    expect(parseMonth("a trip in march", TODAY, "future")).toBe("2027-03");
    expect(parseMonth("spent in march", TODAY, "past")).toBe("2026-03");
    expect(parseMonth("in december", TODAY, "future")).toBe("2026-12");
    expect(parseMonth("in december", TODAY, "past")).toBe("2025-12");
    expect(parseMonth("in october", TODAY, "future")).toBe("2026-10");
    expect(parseMonth("by sept", TODAY, "future")).toBe("2027-09");
  });

  it("keeps a year that's given, and counts months ahead", () => {
    expect(parseMonth("in march 2028", TODAY, "future")).toBe("2028-03");
    expect(parseMonth("in 3 months", TODAY, "future")).toBe("2027-01");
  });

  it("doesn't read 'may I' as May", () => {
    expect(parseMonth("may i afford it", TODAY, "future")).toBeNull();
    expect(parseMonth("in may", TODAY, "future")).toBe("2027-05");
  });
});

describe("normalize", () => {
  it("drops greetings, politeness, curly quotes and closing punctuation", () => {
    expect(normalize("  Hey Jane, please cancel   Hulu for me!! ")).toBe("cancel hulu");
    expect(normalize("Could you lower my phone bill please.")).toBe("lower my phone bill");
    expect(normalize("What’s due?")).toBe("what's due");
  });
});

describe("parseIntent", () => {
  it.each([
    ["can I afford $900 for a trip in March", 90_000, "a trip", "2027-03"],
    ["Can I afford 900?", 90_000, null, null],
    ["could I afford 1.2k for the new couch next month", 120_000, "the new couch", "2026-11"],
    ["can we afford $2,500 for a used car in 3 months", 250_000, "a used car", "2027-01"],
    ["can i afford a vacation", null, "a vacation", null],
  ])("understands %s", (text, amountCents, what, month) => {
    expect(parse(text)).toMatchObject({ kind: "afford", amountCents, what, month });
  });

  // The screenshot that started this: "can I spend…" with an amount is about affording
  // it, not about what was spent.
  it.each([
    ["can I spend 500 dollars this week for food", 50_000, "food", "food", "week", false],
    ["Can I spend $500 on food this week?", 50_000, "food", "food", "week", false],
    ["should I spend $200 on groceries", 20_000, "groceries", "groceries", null, false],
    ["is it ok to spend $500 a month on food", 50_000, "food", "food", "month", true],
    ["could I spend 300 on clothes", 30_000, "clothes", "clothes", null, false],
    ["can we spend $1,200 on a new laptop", 120_000, "a new laptop", null, null, false],
    ["should I buy a $900 couch", 90_000, null, null, null, false],
    [
      "is it okay to spend 80 on eating out this week",
      8_000,
      "eating out",
      "eating out",
      "week",
      false,
    ],
    ["do I have enough for a $900 trip in March", 90_000, null, null, null, false],
    ["can i spend 150 a week on groceries", 15_000, "groceries", "groceries", "week", false],
    ["can I afford $400 a month for a gym", 40_000, "a gym", null, "month", true],
    ["can I spend $600 on rent monthly", 60_000, "rent", "rent", "month", true],
  ])("understands %s as affording it", (text, amountCents, what, category, period, recurring) => {
    expect(parse(text)).toMatchObject({
      kind: "afford",
      amountCents,
      what,
      category,
      period,
      recurring,
    });
  });

  it('doesn\'t take "in a month" as every month', () => {
    expect(parse("can I afford $900 for a trip in a month")).toMatchObject({
      kind: "afford",
      recurring: false,
    });
  });

  it.each([
    ["how much did I spend on food this month", "food", "2026-10"],
    ["How much did I spend on food last month?", "food", "2026-09"],
    ["what did i spend on groceries in september", "groceries", "2026-09"],
    ["spending on eating out", "eating out", "2026-10"],
    ["how much have i spent at Target", "target", "2026-10"],
    ["how much did I spend last month", null, "2026-09"],
    ["how much did i spend this month", null, "2026-10"],
    // No amount, or not a question about the future: still what was spent.
    ["can I see what I spent on food this week", "food", "2026-10"],
    ["did I spend $500 on food this month", "food", "2026-10"],
  ])("understands %s", (text, category, month) => {
    expect(parse(text)).toEqual({ kind: "spending", category, month });
  });

  it.each([
    ["what's due", null],
    ["Whats coming up?", null],
    ["what's coming up this week", 7],
    ["what's due this week", 7],
    ["any upcoming bills", null],
    ["bills due", null],
  ])("understands %s as coming up", (text, days) => {
    expect(parse(text)).toEqual({ kind: "coming_up", days });
  });

  it.each(["safe to spend", "What's safe to spend?", "how much can I spend", "what can i spend"])(
    "understands %s as safe to spend",
    (text) => {
      expect(parse(text)).toEqual({ kind: "safe_to_spend" });
    },
  );

  it.each([
    ["cancel Hulu", "cancel", "hulu"],
    ["Please cancel my Hulu subscription", "cancel", "hulu"],
    ["unsubscribe from netflix", "cancel", "netflix"],
    ["get rid of my gym membership", "cancel", "gym"],
    ["lower my phone bill", "lower", "phone"],
    ["can you reduce my internet bill", "lower", "internet"],
    ["negotiate my verizon bill", "lower", "verizon"],
    ["get my refund from Target", "refund", "target"],
    ["I want my money back from Target", "refund", "target"],
    ["refund the double charge at target", "refund", "double charge at target"],
    ["cancel my subscription", "cancel", ""],
  ])("understands %s", (text, verb, target) => {
    expect(parse(text)).toEqual({ kind: "act", verb, target });
  });

  it.each([
    ["what did you do", "what_did"],
    ["What's new?", "what_did"],
    ["anything new", "what_did"],
    ["what have you been up to", "what_did"],
    ["help", "help"],
    ["what can you do", "help"],
    ["?", "help"],
    ["", "help"],
    ["yes to all", "approve_all"],
    ["approve all the safe ones", "approve_all"],
    ["approve the safe ones", "approve_all"],
    ["undo", "undo"],
    ["Undo that", "undo"],
    ["take it back", "undo"],
    ["pause autopilot", "pause_autopilot"],
    ["stop the autopilot", "pause_autopilot"],
    ["turn off autopilot please", "pause_autopilot"],
    ["is my rent too high?", "unknown"],
    ["tell me a joke", "unknown"],
  ])("understands %s", (text, kind) => {
    expect(parse(text).kind).toBe(kind);
  });
});

describe("matchCategory", () => {
  const labels = ["Food and drink", "Shopping", "Transportation", "Rent and utilities", "Travel"];

  it("matches the label, an everyday word, or the start of a word in the label", () => {
    expect(matchCategory("food and drink", labels)).toBe("Food and drink");
    expect(matchCategory("food", labels)).toBe("Food and drink");
    expect(matchCategory("groceries", labels)).toBe("Food and drink");
    expect(matchCategory("eating out", labels)).toBe("Food and drink");
    expect(matchCategory("gas", labels)).toBe("Transportation");
    expect(matchCategory("rent", labels)).toBe("Rent and utilities");
    expect(matchCategory("shop", labels)).toBe("Shopping");
    expect(matchCategory("flights", labels)).toBe("Travel");
  });

  it("is null for anything else", () => {
    expect(matchCategory("target", labels)).toBeNull();
    expect(matchCategory("", labels)).toBeNull();
    expect(matchCategory("an", labels)).toBeNull();
  });
});
