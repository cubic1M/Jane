import { describe, expect, it } from "vitest";
import { FEE_LIST_PATH } from "@/detectors/bank-fees-of";
import { cardOpensItsFigure } from "./invariants";

// Class 11 (debug 2, sweep 16): the bank-fees card's "See the fees" opened Where your money goes.
const card = (href: string, short = "You paid $139.00 in 7 bank fees in a year.") => ({
  "suggestions.cost:bank_fees.action.href": href,
  "suggestions.cost:bank_fees.short": short,
});

describe("class 11: a card's count and total are the page it opens", () => {
  it("finds a fees card that opens a page without the fees", () => {
    expect(
      cardOpensItsFigure({ ...card("/insights"), "feeList.rows": 7, "feeList.sumCents": 13_900 }),
    ).toEqual([
      'suggestions.cost:bank_fees.action.href: "/insights" doesn\'t list the fees the card counts',
    ]);
  });

  it("finds a list that doesn't add up to the card", () => {
    expect(
      cardOpensItsFigure({ ...card(FEE_LIST_PATH), "feeList.rows": 6, "feeList.sumCents": 11_000 }),
    ).toEqual([
      "suggestions.cost:bank_fees.action.href: the card says 7 fees, $139.00; the page lists 6, $110.00",
    ]);
  });

  it("passes the card and its list, one fee said as one, and a card with no fees", () => {
    expect(
      cardOpensItsFigure({ ...card(FEE_LIST_PATH), "feeList.rows": 7, "feeList.sumCents": 13_900 }),
    ).toEqual([]);
    expect(
      cardOpensItsFigure({
        ...card(FEE_LIST_PATH, "You paid $35.00 in 1 bank fee in 1 month."),
        "feeList.rows": 1,
        "feeList.sumCents": 3_500,
      }),
    ).toEqual([]);
    expect(cardOpensItsFigure({ "suggestions.cost:cushion.action.href": "/goals" })).toEqual([]);
  });

  it("holds a card with a figure to the area item its link focuses", () => {
    const lifeline = {
      "suggestions.cost:lifeline.headline": "Check Lifeline for your phone bill, save $111/yr",
      "suggestions.cost:lifeline.action.href": "/money?focus=charges:lifeline",
    };
    expect(
      cardOpensItsFigure({
        ...lifeline,
        "trees.money.tree.branches.charges.items.charges:lifeline.figure": "$111/yr",
      }),
    ).toEqual([]);
    expect(
      cardOpensItsFigure({
        ...lifeline,
        "trees.money.tree.branches.charges.items.charges:lifeline.figure": "$96/yr",
      }),
    ).toEqual([
      'suggestions.cost:lifeline.action.href: the card says $111; "/money?focus=charges:lifeline" shows $96',
    ]);
  });

  it("holds the cheaper-plan card to Subscriptions' plans and the cushion to its goal page", () => {
    expect(
      cardOpensItsFigure({
        "suggestions.subscriptions:cheaper_tier.headline":
          "Note cheaper plans of what you pay, save $271/yr",
        "suggestions.subscriptions:cheaper_tier.action.href": "/subscriptions",
        "cardPages.plansYearlyCents": 27_084,
      }),
    ).toEqual([]);
    expect(
      cardOpensItsFigure({
        "suggestions.safe_to_spend:emergency_fund.headline":
          "Build an emergency cushion, protect $3,875",
        "suggestions.safe_to_spend:emergency_fund.action.href": "/goals?draft=emergency_fund",
        "cardPages.cushionShortCents": null,
      }),
    ).toEqual([
      'suggestions.safe_to_spend:emergency_fund.action.href: the card says $3875; "/goals?draft=emergency_fund" shows no figure',
    ]);
  });

  it("reads a tree's short figure as the range it rounds", () => {
    const setAside = (figure: string) =>
      cardOpensItsFigure({
        "suggestions.taxes:tax_set_aside.headline": "Set aside for taxes, $13,541",
        "suggestions.taxes:tax_set_aside.action.href": "/taxes?focus=estimate:set-aside",
        "trees.taxes.tree.branches.estimate.items.estimate:set-aside.figure": figure,
      });
    expect(setAside("$14k")).toEqual([]);
    expect(setAside("$12k")).toHaveLength(1);
  });

  it("holds the fees card's headline to the year the page says beside what was paid", () => {
    // A year of checking and a card file from Sep: $68.00 paid, its headline the paced year.
    const paced = {
      "suggestions.cost:bank_fees.action.href": FEE_LIST_PATH,
      "suggestions.cost:bank_fees.short": "You paid $68.00 in 3 bank fees in a year.",
      "suggestions.cost:bank_fees.headline": "Stop paying bank fees, save $358/yr",
      "feeList.rows": 3,
      "feeList.sumCents": 6_800,
    };
    expect(cardOpensItsFigure({ ...paced, "feeList.yearShownCents": 35_800 })).toEqual([]);
    expect(cardOpensItsFigure({ ...paced, "feeList.yearShownCents": null })).toEqual([
      "suggestions.cost:bank_fees.action.href: the card's headline says $358; the page says $68.00",
    ]);
  });

  it("holds a found policy's card to its item on Insurance", () => {
    const card = {
      "dock.3.policyId": "pol1",
      "dock.3.headline":
        "I found your car insurance from your payments: GEICO, $112.40 a month. Is that right?",
    };
    expect(
      cardOpensItsFigure({
        ...card,
        "trees.insurance.tree.branches.policies.items.policies:pol1.figure": "$1.3k/yr",
        "trees.insurance.summaries.policies:pol1":
          "Found from your payments: $112.40 a month, $1,348.80 a year; confirm it to count it.",
      }),
    ).toEqual([]);
    expect(
      cardOpensItsFigure({
        ...card,
        "trees.insurance.tree.branches.policies.items.policies:pol1.figure": "$1.3k/yr",
      }),
    ).toEqual(["dock.3: the card says $112.4; its Insurance item doesn't"]);
  });
});
