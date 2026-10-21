import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { withTopic } from "./context";
import { decisionReply, type DecisionFacts } from "./decision";
import { parseDecision } from "./decision-intents";
import { parseIntent } from "./intents";

// "Should I buy bitcoin?" is a decision about their own money, not a lookup of bitcoin, and
// "should I buy?" afterwards is about the same thing, never an old button.

const ASOF = "2026-10-19";
const facts = (over: Partial<DecisionFacts> = {}): DecisionFacts => ({
  cardDebtCents: 241_050,
  topRateBps: 2300,
  cashCents: 100_000,
  monthlySpendCents: 400_000,
  cushionTargetCents: 1_200_000,
  cushionMonths: 0.3,
  goalsBehind: [{ name: "Emergency fund", leftCents: 500_000 }],
  ...over,
});

describe("reading a decision question", () => {
  it.each([
    ["should i buy bitcoin", "crypto", "bitcoin"],
    ["should I buy some bitcoin?", "crypto", "bitcoin"],
    ["is it a good idea to buy crypto", "crypto", "crypto"],
    ["should i invest in ethereum", "crypto", "ethereum"],
    ["should i buy tesla stock", "stocks", "tesla stock"],
    ["should i buy a house", "home", "a house"],
    ["should i buy a car", "car", "a car"],
    ["should i buy an nft", "crypto", "an nft"],
    ["should i invest", "invest", "investing"],
    ["should i pay off my card or invest", "payoff_or_invest", "paying off debt or investing"],
    [
      "should I invest or pay down my credit card",
      "payoff_or_invest",
      "paying off debt or investing",
    ],
  ])("reads %j as a decision about %s", (text, item, label) => {
    expect(parseIntent(text, ASOF)).toEqual({ kind: "decision", item, label });
  });

  it("reads a bare 'should I buy?' as a decision about nothing yet", () => {
    for (const text of ["should i buy?", "should i buy", "so should i", "should i do it"]) {
      expect(parseIntent(text, ASOF)).toEqual({ kind: "decision", item: null, label: null });
    }
  });

  it("leaves what other answers own to them", () => {
    expect(parseDecision("should i buy a $900 couch")).toBeNull();
    expect(parseDecision("should i buy renters insurance")).toBeNull();
    expect(parseDecision("should i cancel netflix")).toBeNull();
    expect(parseIntent("should i buy a $900 couch", ASOF).kind).toBe("afford");
    expect(parseIntent("how much crypto do i have", ASOF).kind).toBe("investments");
  });
});

// The same question in other words is the same question (the founder's live transcript hid
// that: phrasing the rules didn't match fell to Claude, which talked about a button).
describe("paraphrases of a decision question", () => {
  const cases: [string, string][] = [
    ["crypto", "yea so should i be buying bitcoin"],
    ["crypto", "yea so should i buy bitcoin"],
    ["crypto", "should i get some btc"],
    ["crypto", "is crypto a good idea for me"],
    ["crypto", "is bitcoin worth buying"],
    ["crypto", "do you think i should buy ethereum"],
    ["crypto", "hey, should i be investing in crypto right now"],
    ["crypto", "i'm thinking about buying some bitcoin"],
    ["crypto", "would buying bitcoin be smart"],
    ["crypto", "ok so is bitcoin a good investment"],
    ["stocks", "should i buy some stocks"],
    ["stocks", "is it a good idea to buy tesla stock"],
    ["stocks", "should i be investing in index funds"],
    ["stocks", "am i crazy to buy etfs"],
    ["stocks", "is the stock market a good bet for me"],
    ["stocks", "worth buying some bonds"],
    ["stocks", "um should i get into stocks"],
    ["stocks", "what do you think, should i buy shares"],
    ["stocks", "i should buy an etf right"],
    ["stocks", "should we be buying mutual funds"],
    ["home", "should i buy a house"],
    ["home", "yeah so should i be buying a home"],
    ["home", "is it a good idea to buy a condo"],
    ["home", "i'm thinking of buying an apartment"],
    ["home", "is buying a house worth it"],
    ["home", "do you think i should get a house"],
    ["home", "would buying a home be smart"],
    ["home", "should we buy property"],
    ["home", "hey should i purchase a townhouse"],
    ["home", "ok so is a house a good investment"],
    ["car", "should i buy a car"],
    ["car", "yea should i be buying a truck"],
    ["car", "is it a good idea to get a new car"],
    ["car", "i'm considering buying an suv"],
    ["car", "is buying a car worth it"],
    ["car", "do you think i should purchase a vehicle"],
    ["car", "would getting a car be smart"],
    ["car", "should we get a motorcycle"],
    ["car", "so should i buy a car or not"],
    ["car", "hmm is a new car a good idea"],
    ["payoff_or_invest", "should i pay off my card or invest"],
    ["payoff_or_invest", "yea so should i pay down my credit card or invest"],
    ["payoff_or_invest", "is it better to invest or pay off debt"],
    ["payoff_or_invest", "should i invest or pay off my cards"],
    ["payoff_or_invest", "do you think i should pay off my card or save"],
    ["payoff_or_invest", "pay off debt or invest, which is smarter, should i"],
    ["payoff_or_invest", "ok should i be paying off my card or investing"],
    ["payoff_or_invest", "should i pay down debt vs invest"],
    ["payoff_or_invest", "would it be smart to invest instead of paying off my card"],
    ["payoff_or_invest", "hey should i save or pay off my card"],
  ];
  it.each(cases)("reads %s: %j", (item, text) => {
    expect(parseIntent(text, ASOF), text).toMatchObject({ kind: "decision", item });
  });

  it("still leaves other sectors' and priced questions alone", () => {
    for (const text of [
      "should i buy renters insurance",
      "is a roth a good idea",
      "should i refinance my mortgage",
      "yea so should i buy a $900 couch",
      "should i cancel netflix",
    ]) {
      expect(parseIntent(text, ASOF).kind, text).not.toBe("decision");
    }
  });
});

describe("the follow-up", () => {
  it("takes 'should I buy?' to the decision just discussed", () => {
    const topic = { kind: "decision", category: "crypto", target: "bitcoin" };
    expect(withTopic(parseIntent("should i buy?", ASOF), topic, ASOF)).toEqual({
      kind: "decision",
      item: "crypto",
      label: "bitcoin",
    });
    // Another kind of topic doesn't count.
    expect(
      withTopic(parseIntent("should i buy?", ASOF), { kind: "act", target: "Netflix" }, ASOF),
    ).toMatchObject({ item: null });
  });
});

describe("the answer", () => {
  const ask = (text: string, advice: boolean, f = facts()) =>
    decisionReply(parseDecision(text)!, null, f, advice);

  it("starts from their debts, then the cushion, then goals, in their figures", () => {
    const reply = ask("should i buy bitcoin", true);
    expect(reply.body).toContain("You owe $2,410.50 on credit cards, at up to 23% a year");
    expect(reply.body).toContain("a cushion for you is $12,000.00");
    expect(reply.body).toContain('Your goal "Emergency fund" still has $5,000.00 to go');
    expect(reply.body).toContain("I'd pay the cards down first");
    expect(reply.body).not.toMatch(/don't see any crypto|demo exchange/);
    expect(reply.refs).toMatchObject({
      advice: true,
      topic: { kind: "decision", category: "crypto", target: "bitcoin" },
    });
    // The crypto page is only a follow-up button.
    expect(reply.actions.map((a) => a.label)).toContain("See crypto");
  });

  it("clears the cards from cash that covers them", () => {
    const reply = ask("should i buy bitcoin", true, facts({ cashCents: 5_000_000 }));
    expect(reply.body).toContain("I'd clear the cards first: your cash covers the $2,410.50");
  });

  it("builds the cushion when the cards are clear but the cushion isn't", () => {
    const reply = ask("should i buy a house", true, facts({ cardDebtCents: 0 }));
    expect(reply.body).toContain("You have no credit card debt.");
    expect(reply.body).toContain("I'd build your cushion to $12,000.00 first");
    expect(reply.body).toContain("down payment");
  });

  it("says the basics are covered when they are", () => {
    const reply = ask(
      "should i buy stocks",
      true,
      facts({ cardDebtCents: 0, cashCents: 5_000_000, goalsBehind: [] }),
    );
    expect(reply.body).toContain("Your basics look covered");
  });

  it("gives only the facts on a real account", () => {
    const reply = ask("should i buy bitcoin", false);
    expect(reply.body).toContain("You owe $2,410.50");
    expect(reply.body).toContain("I don't give advice on what to buy with your real accounts");
    expect(reply.body).not.toMatch(/I'd |you should/i);
    expect(reply.refs.advice).toBeUndefined();
  });

  it("asks what, when nothing was discussed", () => {
    const reply = decisionReply({ kind: "decision", item: null, label: null }, null, facts(), true);
    expect(reply.body).toMatch(/^Buy what\?/);
    expect(reply.actions).toEqual([]);
  });
});
