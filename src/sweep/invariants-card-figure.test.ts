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
});
