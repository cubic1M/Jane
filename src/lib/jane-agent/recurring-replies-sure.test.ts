import { describe, expect, it } from "vitest";
import type { Charge, Recurring } from "./recurring";
import { subscriptionsReply } from "./recurring-replies";
import type { Snapshot, SnapshotFinding } from "./snapshot";

// A finding's card says how sure Jane is ("75% sure: 6 charges in 6 months of data."). The
// subscriptions answer carries the card's words after its list, in three sentences at most: how
// sure is folded into the saving, not a fourth sentence (debt-decisions.integration.test.ts).

const charge = (merchant: string, cents: number, openFindingId: string | null = null): Charge => ({
  key: merchant,
  merchantKey: merchant.toLowerCase(),
  merchant,
  accountId: null,
  transactionIds: [],
  frequency: "MONTHLY",
  lastAmountCents: cents,
  lastDate: "2026-10-14",
  nextDate: "2026-11-14",
  annualCostCents: cents * 12,
  subscription: true,
  maybeSubscription: false,
  openFindingId,
});
const recurring: Recurring = {
  charges: [charge("Netflix", 1_799, "f1"), charge("Spotify", 1_199)],
  nextIncome: null,
};
const finding: SnapshotFinding = {
  findingId: "f1",
  type: "subscription_review",
  title: "Review your Netflix subscription",
  annualSavingsCents: 21_588,
  savings: "Could save about $215.88 a year",
  fingerprint: "fp1",
  urgent: false,
  pick: null,
  sure: { percent: 75, reason: "6 charges in 6 months of data" },
};
const snapshot = { timezone: null, findings: [finding] } as unknown as Snapshot;

describe("the subscriptions answer with a finding that says how sure", () => {
  it("keeps to three sentences, how sure beside the saving", () => {
    const body = subscriptionsReply({ total: false, all: false }, recurring, snapshot).body;
    expect(body).toMatch(
      /Review your Netflix subscription: could save about \$215\.88 a year \(75% sure\)\. Want /,
    );
    expect(body.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3);
  });
});
