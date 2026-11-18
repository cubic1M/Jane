import { describe, expect, it } from "vitest";
import type { Snapshot, SnapshotFinding } from "../snapshot";
import { findingsSource } from "./findings";

// Debug 2, sixth desktop sweep (11-18, Plaid sandbox checking that sends $500 a month to
// Fidelity): the dock had "Note Netflix's Standard with ads plan, save $78/yr" (the day's
// cheaper_tier suggestion) and "Review your Netflix subscription. Could save about $185.88 a year":
// one subscription, two cards. The cheaper plan says that service; other services' cards stay.

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
const gather = (topics: string[], title = "Go through your subscriptions") =>
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

describe("a service's subscription card beside its cheaper plan", () => {
  it("isn't raised for the service the cheaper plan names", () => {
    expect(
      gather(["cheaper_tier"], "Netflix lists a cheaper plan than the one you pay for").sort(),
    ).toEqual(["f1", "f3", "f4"]);
  });

  it("is raised for every service without one", () => {
    expect(
      gather(["cheaper_tier"], "ChatGPT lists a cheaper plan than the one you pay for").sort(),
    ).toEqual(["f1", "f2", "f3", "f4"]);
  });
});
