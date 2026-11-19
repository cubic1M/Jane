import { describe, expect, it } from "vitest";
import type { Snapshot, SnapshotFinding } from "../snapshot";
import { findingsSource } from "./findings";

// Debug 2, sixth desktop sweep (11-18, upload S7: one Bank of America checking statement with a
// $12.00 monthly fee): the dock had the day's "Ask about your waivable bank fee, save $144/yr"
// (fee_waiver_met) and the report's "$60.00 in fees on Bank of America checking in the last 5
// months. Could save about $144.00 a year": one fee, two cards. The waiver card says that bank's
// fees; another bank's fee card stays.

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
  ...sub("f4", "x", 14_400),
  type: "bank_fees",
  title: "$60.00 in fees on Bank of America checking in the last 5 months",
};
const otherFees: SnapshotFinding = {
  ...sub("f5", "x", 11_000),
  type: "bank_fees",
  title: "$110.00 in fees on Wells Fargo checking in the last 12 months",
};
const findings = [
  sub("f1", "Spotify", 7_188),
  sub("f2", "Netflix", 18_588),
  sub("f3", "Planet Fitness", 45_600),
  fees,
  otherFees,
];
const gather = (topics: string[], title = "Go through your subscriptions", short = "") =>
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
          title,
          headline: "Cancel subscriptions you don't use, save $178/yr",
          short,
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

describe("a bank's fee card beside the day's fee-waiver suggestion", () => {
  it("isn't raised for the bank the waiver names", () => {
    expect(
      gather(
        ["fee_waiver_met"],
        "Advantage SafeBalance Banking has no monthly fee with a qualifying deposit, according to Bank of America's page",
        "Bank of America charged a $12.00 monthly fee on Oct 20; $3,000.00 in pay came in that month.",
      ).sort(),
    ).toEqual(["f1", "f2", "f3", "f5"]);
  });

  it("is raised without one", () => {
    expect(gather(["emergency_fund"]).sort()).toEqual(["f1", "f2", "f3", "f4", "f5"]);
  });
});
