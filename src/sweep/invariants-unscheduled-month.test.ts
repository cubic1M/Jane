import { describe, expect, it } from "vitest";
import { unscheduledMonth } from "./invariants";

// Class 4 for pay off any schedule (debug 2, sweep 13): Home's $1,377 against the profile's $1,351.82.

describe("pay off any schedule reads one month", () => {
  it("names Home's month against another on the profile", () => {
    expect(
      unscheduledMonth({
        "income.payOnly": true,
        "home.summary.safeToSpend.unevenPayMonthlyCents": 137_680,
        "profile.facts.monthly_income.value": 135_182,
      }),
    ).toEqual(["home's uneven pay 137680 a month, the profile's month 135182"]);
  });

  it("passes the same month, or no uneven pay on Home", () => {
    expect(
      unscheduledMonth({
        "home.summary.safeToSpend.unevenPayMonthlyCents": 137_680,
        "profile.facts.monthly_income.value": 137_680,
      }),
    ).toEqual([]);
    expect(unscheduledMonth({ "profile.facts.monthly_income.value": 137_680 })).toEqual([]);
    // A freelancer's income isn't only pay: read apart on purpose for now.
    expect(
      unscheduledMonth({
        "income.payOnly": false,
        "home.summary.safeToSpend.unevenPayMonthlyCents": 846_189,
        "profile.facts.monthly_income.value": 586_806,
      }),
    ).toEqual([]);
  });
});
