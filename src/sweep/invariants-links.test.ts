import { describe, expect, it } from "vitest";
import { hiddenPageLinks } from "./invariants";

// The hidden-page rule (class 9, debug3-invariants.md): no link to a page the beta hides, a
// "See …" button included. A suggestion's button and the chat's links are drawn through
// landing(), which sends a hidden page to its area page.

describe("a link to a page the beta hides", () => {
  it("is caught wherever it's drawn as it is", () => {
    expect(
      hiddenPageLinks({
        "home.cashFlow.events.pay-0.href": "/transfers",
        "home.summary.comingUp.enrollment.href": "/insurance/benefits",
        "trees.loans.tree.branches.costs.items.x.href": "/loans/costly",
        "home.cashFlow.events.bill-0.href": "/bills",
      }),
    ).toEqual([
      "home.cashFlow.events.pay-0.href: goes to /transfers, a page the beta hides",
      "home.summary.comingUp.enrollment.href: goes to /insurance/benefits, a page the beta hides",
      "trees.loans.tree.branches.costs.items.x.href: goes to /loans/costly, a page the beta hides",
    ]);
  });

  it("is let be where the card or the chat draws it through landing()", () => {
    expect(
      hiddenPageLinks({
        "suggestions.debt:high_cost_loans.action.href": "/loans/costly",
        "chat.what should I do first.actions.0.href": "/investments/fees",
      }),
    ).toEqual([]);
  });
});
