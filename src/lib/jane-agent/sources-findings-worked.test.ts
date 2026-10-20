import { describe, expect, it } from "vitest";
import type { Snapshot, SnapshotFinding } from "./snapshot";
import { findingsSource } from "./sources/findings";

// Spec step 147 reads step 207: a kind of finding whose finished actions never showed a
// saving is asked about one at a time.

const finding = (id: string, type: SnapshotFinding["type"]): SnapshotFinding => ({
  findingId: id,
  type,
  title: `Lower your bill ${id}`,
  annualSavingsCents: 10_000,
  savings: "Could save about $100 a year.",
  fingerprint: id,
  urgent: false,
  pick: null,
});
const snapshot = (worked: Snapshot["worked"]) =>
  ({
    asOf: "2026-10-19",
    findings: [
      finding("a", "bill_negotiation"),
      finding("b", "bill_negotiation"),
      finding("c", "bank_fees"),
    ],
    changes: [],
    agentSteps: [],
    deadlines: [],
    worked,
  }) as unknown as Snapshot;
const ids = (s: Snapshot) =>
  findingsSource
    .gather(s, {
      now: new Date(),
      local: { date: "2026-10-19", hour: 9 },
      trigger: "sync",
    } as never)
    .map((c) => c.dedupeKey);

describe("findings source and what worked", () => {
  it("asks about every finding when nothing is known", () => {
    expect(ids(snapshot(undefined))).toHaveLength(3);
  });

  it("asks about a kind that never showed a saving one at a time", () => {
    const worked = [
      {
        type: "bill_negotiation" as const,
        yes: 3,
        no: 0,
        done: 3,
        worked: 0,
        notShown: 3,
        workedCents: 0,
      },
    ];
    const asked = ids(snapshot(worked));
    expect(asked).toHaveLength(2);
    expect(asked.filter((id) => id !== "c")).toHaveLength(1);
  });

  it("does not hold back a kind that has worked", () => {
    const worked = [
      {
        type: "bill_negotiation" as const,
        yes: 3,
        no: 0,
        done: 3,
        worked: 1,
        notShown: 2,
        workedCents: 5_000,
      },
    ];
    expect(ids(snapshot(worked))).toHaveLength(3);
  });
});
