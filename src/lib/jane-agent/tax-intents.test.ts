import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Spec step 118: what people type about their tax profile, read by rules.
const parse = (text: string) => parseIntent(text, "2026-10-19");

describe("tax intents", () => {
  it.each([
    "what's my tax profile",
    "Jane, my filing status?",
    "taxes",
    "help me with my taxes",
    "set up my taxes please",
    "what do you know about my taxes",
  ])("%s asks for the profile", (text) => {
    expect(parse(text)).toEqual({ kind: "tax", ask: "profile" });
  });

  it.each([
    ["I'm married filing jointly", "married_joint"],
    ["we file jointly", "married_joint"],
    ["married filing separately", "married_separate"],
    ["I'm head of household", "head_of_household"],
    ["I'm single", "single"],
    ["my status is single", "single"],
  ])("%s sets the filing status", (text, status) => {
    expect(parse(text)).toEqual({ kind: "tax", ask: "set_filing", status });
  });

  it("I'm married could be either way", () => {
    expect(parse("I'm married")).toEqual({ kind: "tax", ask: "set_filing", status: null });
    expect(parse("we got married!")).toEqual({ kind: "tax", ask: "set_filing", status: null });
  });

  it.each([
    ["I have 2 kids", 2],
    ["i have two children", 2],
    ["I have no kids", 0],
    ["I have a child", 1],
    ["I'll claim 4 dependents", 4],
  ])("%s sets the children", (text, count) => {
    expect(parse(text)).toEqual({ kind: "tax", ask: "set_kids", count });
  });

  it.each([
    ["I live in Texas", "TX"],
    ["we live in new york", "NY"],
    ["I file in CA", "CA"],
  ])("%s sets the state", (text, state) => {
    expect(parse(text)).toEqual({ kind: "tax", ask: "set_state", state });
  });

  it.each([
    ["how much will I owe in taxes", "estimate"],
    ["how much tax will I pay", "estimate"],
    ["will I get a refund", "estimate"],
    ["my tax estimate", "estimate"],
    ["what's my tax bracket", "bracket"],
    ["what's my marginal rate", "bracket"],
    ["am I withholding enough", "withholding"],
    ["should I change my W-4", "withholding"],
    ["too much tax withheld?", "withholding"],
    ["how can I pay less tax", "savings"],
    ["any tax breaks for me?", "savings"],
    ["what can I deduct", "savings"],
  ])("%s asks about %s (steps 120–121)", (text, ask) => {
    expect(parse(text)).toEqual({ kind: "tax", ask });
  });

  it("leaves debts to the loans: how much do I owe isn't a tax question", () => {
    expect(parse("how much do I owe").kind).not.toBe("tax");
    expect(parse("how much do I owe on my car").kind).not.toBe("tax");
  });

  it("leaves everything else alone", () => {
    expect(parse("I live in a van").kind).toBe("unknown");
    expect(parse("get my refund from Target")).toMatchObject({ kind: "act", verb: "refund" });
    expect(parse("how much did I spend on food last month").kind).toBe("spending");
    expect(parse("what's due this week").kind).toBe("coming_up");
  });

  it.each([
    "how much tax will I owe",
    "how much will I owe in taxes",
    "what will I owe the IRS",
    "will I get a refund",
    "tax estimate",
  ])("%s asks for the estimate", (text) => {
    expect(parse(text)).toEqual({ kind: "tax", ask: "estimate" });
  });

  // Owing without a tax word is about debts (./debt-intents.ts).
  it.each(["How much do I owe?", "what do I owe on my car", "when is my car paid off"])(
    "%s isn't a tax question",
    (text) => {
      expect(parse(text).kind).not.toBe("tax");
    },
  );
});
