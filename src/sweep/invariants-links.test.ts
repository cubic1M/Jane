import { describe, expect, it } from "vitest";
import { hiddenPageLinks } from "./invariants";

// The hidden-page rule (class 9, debug3-invariants.md).

describe("a link to a page the beta hides", () => {
  it("is caught unless it only promises a look", () => {
    expect(
      hiddenPageLinks({
        "home.cashFlow.events.pay-0.href": "/transfers",
        "home.cashFlow.events.pay-0.label": "Acme Corp",
        "suggestions.x.action.href": "/insurance/benefits",
        "suggestions.x.action.label": "Start a claim",
        "suggestions.y.action.href": "/insurance/benefits",
        "suggestions.y.action.label": "See your benefits",
        "suggestions.z.action.href": "/money",
        "suggestions.z.action.label": "Start",
      }),
    ).toEqual([
      'home.cashFlow.events.pay-0.href: "Acme Corp" goes to /transfers, a page the beta hides',
      'suggestions.x.action.href: "Start a claim" goes to /insurance/benefits, a page the beta hides',
    ]);
  });
});
