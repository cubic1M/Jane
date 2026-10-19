import { describe, expect, it } from "vitest";
import { withTopic, type Topic } from "./context";
import { fixTypos, oneSlip, parseIntent } from "./intents";
import { nameMatches } from "./names";

// Spec step 88: Jane understands more. Merchants' costs, paydays, subscriptions, a finding
// by name, typos and short forms, and follow-ups read against what was just said.

const TODAY = "2026-10-18";
const parse = (text: string) => parseIntent(text, TODAY);

describe("typos and short forms", () => {
  it("fixes one slipped letter in the words the rules look for", () => {
    expect(fixTypos("cancle hulu")).toBe("cancel hulu");
    expect(fixTypos("can i aford $300 for shoes")).toBe("can i afford $300 for shoes");
    expect(fixTypos("safe to spnd")).toBe("safe to spend");
    expect(fixTypos("safe 2 spend")).toBe("safe to spend");
    expect(fixTypos("hw much did i spend on fod last month")).toBe(
      "how much did i spend on food last month",
    );
    expect(fixTypos("whats due this wk")).toBe("what's due this week");
    expect(fixTypos("subs")).toBe("subscriptions");
  });

  it("never changes a name or a different word", () => {
    expect(fixTypos("lyft")).toBe("lyft");
    expect(fixTypos("power bill")).toBe("power bill");
    expect(fixTypos("spent $2 on gum")).toBe("spent $2 on gum");
    expect(fixTypos("i have 2 kids")).toBe("i have 2 kids");
    expect(oneSlip("cancle", "cancel")).toBe(true);
    expect(oneSlip("hulu", "lulu")).toBe(true);
    expect(oneSlip("netflix", "nettflixx")).toBe(false);
  });

  it("understands the slips people make", () => {
    expect(parse("cancle hulu")).toMatchObject({ kind: "act", verb: "cancel", target: "hulu" });
    expect(parse("safe 2 spend")).toEqual({ kind: "safe_to_spend" });
    expect(parse("whats due this wk")).toMatchObject({ kind: "coming_up", days: 7 });
  });
});

describe("new questions", () => {
  it.each([
    ["how much is Netflix", "netflix", false],
    ["how much do I pay for Spotify", "spotify", false],
    ["what does Hulu cost me", "hulu", false],
    ["how much is my phone bill", "phone", false],
    ["how much do I pay for Comcast a year", "comcast", true],
    ["what's the cost of my gym", "gym", false],
  ])("reads %s as what one thing costs", (text, target, year) => {
    expect(parse(text)).toEqual({ kind: "cost", target, year });
  });

  it("leaves 'how much' questions that are about something else alone", () => {
    expect(parse("how much did I spend on food").kind).toBe("spending");
    expect(parse("how much can I spend").kind).toBe("safe_to_spend");
    expect(parse("how much money do i have left").kind).toBe("safe_to_spend");
    expect(parse("how much do I have to spend").kind).toBe("safe_to_spend");
  });

  it("reads whether bills are paid (spec step 145)", () => {
    for (const text of [
      "are my bills paid",
      "pay my credit card",
      "bill pay",
      "is my card covered",
    ]) {
      expect(parse(text), text).toEqual({ kind: "bills_paid" });
    }
    expect(parse("what bills are due this week").kind).not.toBe("bills_paid");
  });

  it("reads paydays and subscriptions", () => {
    for (const text of ["when do I get paid", "when's my next paycheck", "next payday"]) {
      expect(parse(text), text).toEqual({ kind: "payday" });
    }
    expect(parse("what subscriptions do I have")).toEqual({
      kind: "subscriptions",
      total: false,
      all: false,
    });
    expect(parse("subs")).toMatchObject({ kind: "subscriptions" });
    expect(parse("how much do I spend on subscriptions")).toMatchObject({
      kind: "subscriptions",
      total: true,
    });
    expect(parse("what am I paying for every month")).toMatchObject({
      kind: "subscriptions",
      all: true,
    });
    // Cancelling one is still cancelling.
    expect(parse("cancel my Netflix subscription")).toMatchObject({
      kind: "act",
      target: "netflix",
    });
  });

  it("reads a name on its own, or 'tell me about', as asking about it", () => {
    expect(parse("netflix?")).toEqual({ kind: "about", target: "netflix" });
    expect(parse("the bank fees")).toEqual({ kind: "about", target: "bank fees" });
    expect(parse("tell me about the MasterClass charge")).toEqual({
      kind: "about",
      target: "masterclass",
    });
    expect(parse("stop paying for Peacock")).toMatchObject({ kind: "act", target: "peacock" });
    expect(parse("where does my money go")).toMatchObject({ kind: "spending", category: null });
  });

  it("reads follow-ups", () => {
    expect(parse("and Hulu?")).toEqual({ kind: "follow_up", target: "hulu", month: null });
    expect(parse("what about this month?")).toEqual({
      kind: "follow_up",
      target: null,
      month: "2026-10",
    });
    expect(parse("and in August?")).toEqual({ kind: "follow_up", target: null, month: "2026-08" });
    expect(parse("what about last month")).toMatchObject({ month: "2026-09" });
    expect(parse("cancel it")).toMatchObject({ kind: "act", target: "it" });
  });
});

describe("withTopic", () => {
  const act: Topic = { kind: "act", verb: "cancel", target: "Hulu", findingId: "f1" };
  const cost: Topic = { kind: "cost", target: "Netflix", findingId: "f9" };
  const spent: Topic = { kind: "spending", month: "2026-09", category: "food" };

  it("asks the same of another name", () => {
    expect(withTopic(parse("and Peacock?"), act, TODAY)).toEqual({
      kind: "act",
      verb: "cancel",
      target: "peacock",
    });
    expect(withTopic(parse("and Spotify?"), cost, TODAY)).toEqual({
      kind: "cost",
      target: "spotify",
      year: false,
    });
    expect(withTopic(parse("and coffee?"), spent, TODAY)).toEqual({
      kind: "spending",
      category: "coffee",
      month: "2026-09",
    });
  });

  it("asks the same of another month", () => {
    expect(withTopic(parse("what about this month?"), spent, TODAY)).toEqual({
      kind: "spending",
      category: "food",
      month: "2026-10",
    });
    expect(withTopic(parse("and in August?"), cost, TODAY)).toEqual({
      kind: "spending",
      category: "Netflix",
      month: "2026-08",
    });
  });

  it("points 'it' at what was talked about, the same finding exactly", () => {
    expect(withTopic(parse("cancel it"), cost, TODAY)).toEqual({
      kind: "act",
      verb: "cancel",
      target: "Netflix",
      findingId: "f9",
    });
    expect(withTopic(parse("how much is it"), act, TODAY)).toMatchObject({
      kind: "cost",
      target: "Hulu",
    });
  });

  it("asks which when 'it' has nothing to point at", () => {
    expect(withTopic(parse("cancel it"), null, TODAY)).toEqual({ kind: "which" });
    expect(withTopic(parse("and Hulu?"), null, TODAY)).toEqual({ kind: "about", target: "hulu" });
    expect(withTopic(parse("what about last month"), null, TODAY)).toEqual({ kind: "unknown" });
  });

  it("leaves everything else alone", () => {
    expect(withTopic(parse("safe to spend"), act, TODAY)).toEqual({ kind: "safe_to_spend" });
  });
});

describe("nameMatches", () => {
  it("knows what people call things, and one slipped letter", () => {
    expect(nameMatches("phone", "Verizon Wireless")).toBe(true);
    expect(nameMatches("gym", "Planet Fitness")).toBe(true);
    expect(nameMatches("internet", "Comcast")).toBe(true);
    expect(nameMatches("netflx", "Netflix")).toBe(true);
    expect(nameMatches("hulu", "Netflix")).toBe(false);
    expect(nameMatches("", "Netflix")).toBe(false);
  });
});
