import { describe, expect, it } from "vitest";
import { dockDoubles } from "./invariants";
import { DATED } from "./reasons";

// Class 7 in the dock (debug 2, sweep 8, 11-19; debug 3, 11-21): the dock says one thing once.
// After a refresh it had "Note Netflix's Standard with ads plan" beside "Review your Netflix
// subscription." (#2153); on demo's Nov 28, "Drop an overlapping subscription", which drops Spotify,
// beside "Review your Spotify subscription". Read as drawn: each card's headline, what it's about
// and its merchants (src/sweep/snapshot.ts).

const card = (i: number, about: string | null, headline: string, merchants: string[]) => ({
  [`dock.${i}.about`]: about,
  [`dock.${i}.headline`]: headline,
  ...Object.fromEntries(merchants.map((m, k) => [`dock.${i}.merchants.${k}`, m])),
});
const overlapping = card(
  0,
  "subscriptions:duplicate_subscription",
  "Drop an overlapping subscription, save $240/yr",
  ["spotify usa", "peacock premium"],
);

describe("one matter, one dock card", () => {
  it("fails a post a pick already asks, by merchant key (demo, Nov 28)", () => {
    expect(
      dockDoubles({
        ...overlapping,
        ...card(1, "finding:subscription_review", "Review your Spotify subscription.", ["spotify"]),
      }),
    ).toEqual([
      `dock.1: "Review your Spotify subscription." asks what dock.0 "Drop an overlapping subscription, save $240/yr" asks, about spotify`,
    ]);
  });

  it("fails two posts of one matter about one merchant, and a cheaper plan beside a review (#2153)", () => {
    expect(
      dockDoubles({
        ...card(0, "subscriptions:cheaper_tier", "Note Netflix's Standard with ads plan", [
          "netflix",
        ]),
        ...card(1, "finding:subscription_review", "Review your Netflix subscription.", ["netflix"]),
        ...card(2, "finding:trial_conversion", "Your Netflix trial turned into a charge.", [
          "netflix",
        ]),
      }),
    ).toHaveLength(3);
  });

  it("passes two matters about one merchant, a name inside a fund, and two picks", () => {
    expect(
      dockDoubles({
        ...card(0, "subscriptions:subscriptions", "Cancel subscriptions you don't use", [
          "netflix",
        ]),
        ...card(1, "finding:price_increase", "Netflix went up from $15.49 to $17.99.", ["netflix"]),
        ...card(2, "investing:investment_fees", "Check fund costs: Northstar Target 2055 Fund", []),
        ...card(3, "finding:duplicate_charge", "Charged twice? $64.20 at Target.", ["target"]),
        ...card(4, "subscriptions:cheaper_tier", "Note Netflix's Standard with ads plan", [
          "netflix",
        ]),
        ...card(5, null, "Coming up in 3 days: Demo Car Loan payment ($494.10).", []),
      }),
    ).toEqual([]);
    expect(
      dockDoubles({
        ...overlapping,
        ...card(1, "subscriptions:subscriptions", "Cancel subscriptions you don't use", [
          "spotify",
        ]),
      }),
    ).toEqual([]);
  });

  it("lets the dock's stack move with what it draws in the calendar sweep", () => {
    const stack = DATED.find((r) => r.name === "the dock's stack");
    expect(stack?.paths.test("dock.3.headline")).toBe(true);
    expect(stack?.paths.test("suggestions.cost:duplicate_charge.headline")).toBe(false);
  });
});
