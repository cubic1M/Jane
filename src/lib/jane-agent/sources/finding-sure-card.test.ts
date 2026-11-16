import { describe, expect, it } from "vitest";
import { findingCandidate } from "./findings";
import { findingSure } from "@/lib/report-state";

// Debugger 11-16 (gate D, a student linked through Plaid sandbox): the dock's "Review your Spotify
// subscription" said what it could save and asked for a yes, but never how sure Jane was, though
// /report beside it said "75% sure: 6 charges in 6 months of data". Every suggestion says how sure.

const spotify = {
  type: "subscription_review" as const,
  evidence: { transactions: ["t1", "t2", "t3", "t4", "t5", "t6"] },
  confidence: "medium" as const,
};

const card = (sure?: { percent: number; reason: string }) =>
  findingCandidate(
    {
      findingId: "f1",
      title: "Review your Spotify subscription",
      annualSavingsCents: 15_180,
      savings: "Could save about $151.80 a year",
      fingerprint: "fp",
      urgent: false,
      pick: null,
      ...spotify,
      ...(sure ? { sure } : {}),
    },
    false,
  );

describe("a finding's card", () => {
  it("says how sure Jane is, in /report's words", () => {
    const sure = findingSure(spotify, [], 6);
    expect(card(sure).body).toBe(
      `Review your Spotify subscription. Could save about $151.80 a year. ${sure.percent}% sure: 6 charges in 6 months of data. Want the steps to do it yourself?`,
    );
  });

  it("is unchanged for a snapshot built by hand", () => {
    expect(card().body).toBe(
      "Review your Spotify subscription. Could save about $151.80 a year. Want the steps to do it yourself?",
    );
  });
});
