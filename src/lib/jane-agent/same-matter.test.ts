import { describe, expect, it } from "vitest";
import { matterOf, sameMerchant, saidByPicks, watchedMerchants } from "./same-matter";

// The dock says one thing once (debug 3, 11-21): demo's day had "Drop an overlapping
// subscription", which drops Spotify and Peacock, beside "Review your Spotify subscription".

const overlapping = {
  topic: "duplicate_subscription",
  watch: {
    kind: "charge_stops",
    payees: [
      { description: "SPOTIFY USA", amountCents: 1_199, perYear: 12 },
      { description: "PEACOCK PREMIUM", amountCents: 799, perYear: 12 },
    ],
  },
};
const cheaperNetflix = {
  topic: "cheaper_tier",
  watch: { kind: "bill_drops", payees: [{ description: "NETFLIX.COM", beforeCents: 1_799 }] },
};

describe("one matter about one merchant", () => {
  it("is a finding a day's pick already asks: a review of a subscription the pick drops", () => {
    const said = saidByPicks(
      [overlapping],
      [
        { id: "spotify", type: "subscription_review", merchant: "Spotify" },
        { id: "peacock", type: "subscription_review", merchant: "Peacock" },
      ],
    );
    expect([...said].sort()).toEqual(["peacock", "spotify"]);
  });

  it("isn't one the pick only names: the overlapping pick keeps Netflix", () => {
    expect(
      saidByPicks([overlapping], [{ id: "n", type: "subscription_review", merchant: "Netflix" }]),
    ).toEqual(new Set());
  });

  it("keeps two matters about one merchant: Netflix's price rise beside its cheaper plan", () => {
    expect(
      saidByPicks([cheaperNetflix], [{ id: "rise", type: "price_increase", merchant: "Netflix" }]),
    ).toEqual(new Set());
    expect(
      saidByPicks(
        [cheaperNetflix],
        [{ id: "r", type: "subscription_review", merchant: "Netflix" }],
      ),
    ).toEqual(new Set(["r"]));
  });

  it("matches a merchant by its key, never by a word in a name", () => {
    expect(sameMerchant("spotify", "spotify usa")).toBe(true);
    expect(sameMerchant("target", "northstar target 2055 fund")).toBe(false);
    expect(sameMerchant("spotify", "spotifyx")).toBe(false);
    expect(
      saidByPicks(
        [
          {
            topic: "duplicate_charge",
            watch: { kind: "refund", payees: [{ description: "TARGET" }] },
          },
        ],
        [
          { id: "twice", type: "duplicate_charge", merchant: "Target" },
          { id: "none", type: "duplicate_charge", merchant: null },
        ],
      ),
    ).toEqual(new Set(["twice"]));
  });

  it("asks nothing of a pick with no payees, and keeps each other topic to itself", () => {
    expect(watchedMerchants(null)).toEqual([]);
    expect(watchedMerchants({ kind: "fee_stops", pfcs: [], monthlyCents: 0 })).toEqual([]);
    expect(matterOf("trial_conversion")).toBe(matterOf("subscriptions"));
    expect(matterOf("price_increase")).not.toBe(matterOf("cheaper_tier"));
  });
});
