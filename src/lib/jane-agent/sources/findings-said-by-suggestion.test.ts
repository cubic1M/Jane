import { describe, expect, it } from "vitest";
import type { Snapshot, SnapshotFinding } from "../snapshot";
import { findingsSource } from "./findings";

// Debug 2 (11-16, Plaid sandbox, 14 months of checking and a card, the dock at 1280 light): the
// dock had the day's suggestion "Cancel subscriptions you don't use, save $178/yr" (a quarter of
// Spotify, Netflix and Planet Fitness) and also "Review your Spotify subscription", "Review your
// Netflix subscription" and "Review your Planet Fitness subscription": the same money, four cards.
// While a suggestion about a kind of finding is one of the day's, its findings aren't raised.

const sub = (id: string, name: string, cents: number): SnapshotFinding => ({
  findingId: id,
  type: "subscription_review",
  title: `Review your ${name} subscription`,
  annualSavingsCents: cents,
  savings: `Could save about $${(cents / 100).toFixed(2)} a year`,
  fingerprint: id,
  urgent: false,
  pick: null,
});
const fees: SnapshotFinding = {
  ...sub("f4", "x", 11_000),
  type: "bank_fees",
  title: "$110.00 in fees on Plaid checking in the last 12 months",
};
const findings = [
  sub("f1", "Spotify", 7_188),
  sub("f2", "Netflix", 18_588),
  sub("f3", "Planet Fitness", 45_600),
  fees,
];
const gather = (topics: string[]) =>
  findingsSource
    .gather(
      {
        // What the priority engine reads (as primer-matters.test.ts builds it).
        plan: { items: 0, annualSavingsCents: 0, safeItems: 0 },
        ruleApprovals: [],
        finished: [],
        deadlines: [],
        budgetsOver: [],
        goalsBehind: [],
        urgentAlerts: [],
        budgetProgress: [],
        autopilot: "safe",
        setupProposals: [],
        agentSteps: [],
        assetPrompts: [],
        findings,
        suggestions: topics.map((topic, i) => ({
          id: `s${i}`,
          chosenOn: "2026-11-16",
          key: `k${i}`,
          topic,
          title: "Go through your subscriptions",
          headline: "Cancel subscriptions you don't use, save $178/yr",
          short: "You pay about $713.76 a year across 3 subscriptions.",
          why: "People who look at the list usually drop about a quarter.",
          worthCents: 17_844,
          worthKind: "saves",
          confidencePercent: 87,
          confidenceReason: "3 subscription charges in 12 months of data",
          actionLabel: "Review subscriptions",
          actionHref: "/subscriptions",
          more: [],
          advice: false,
        })),
      } as unknown as Snapshot,
      { local: { date: "2026-11-16" } } as never,
    )
    .map((c) => (c.refs as { findingId: string }).findingId);

describe("finding cards beside the day's suggestions", () => {
  it("aren't raised when a suggestion of the day is about that kind of finding", () => {
    expect(gather(["subscriptions"]).sort()).toEqual(["f4"]);
  });

  it("are raised when it isn't", () => {
    expect(gather(["emergency_fund"]).sort()).toEqual(["f1", "f2", "f3", "f4"]);
  });
});
