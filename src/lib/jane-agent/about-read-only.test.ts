import { describe, expect, it } from "vitest";
import { aboutReply } from "./capabilities/money";
import type { Recurring } from "./recurring";
import type { Snapshot, SnapshotFinding } from "./snapshot";

// Debugger 11-17 (r330, a real-account Plaid sandbox person with an idle cash finding, chat on a
// phone): "should I move my extra cash somewhere?" answered "… Want me to handle it?", while the
// same person's Spotify answer said "Want the steps to do it yourself?". The "about" answer left
// out the person's read-only mode; every other way to a finding passes it.

const finding: SnapshotFinding = {
  findingId: "f1",
  type: "idle_cash",
  title: "$1,192.86 more cash than 3 months of spending",
  annualSavingsCents: 4_175,
  savings: "Could earn about $41.75 a year",
  fingerprint: "idle",
  urgent: false,
  pick: null,
};
const snapshot = (concierge: boolean) =>
  ({ concierge, findings: [finding], asOf: "2026-11-17" }) as unknown as Snapshot;
const recurring = { charges: [] } as unknown as Recurring;
const ask = (concierge: boolean, findingId?: string) =>
  aboutReply(
    { kind: "about", target: "cash", ...(findingId ? { findingId } : {}) },
    recurring,
    snapshot(concierge),
    "2026-11-17",
  )?.body ?? "";

describe("a finding asked about by name", () => {
  it("offers a read-only account the steps", () => {
    expect(ask(false)).toContain("Want the steps to do it yourself?");
    expect(ask(false)).not.toContain("Want me to handle it?");
    expect(ask(false, "f1")).toContain("Want the steps to do it yourself?");
  });

  it("still offers to handle it where Jane can", () => {
    expect(ask(true)).toContain("Want me to handle it?");
  });
});
