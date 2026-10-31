import { describe, expect, it } from "vitest";
import { headsUpsSource } from "./sources/heads-ups";
import type { Snapshot, SnapshotFinding } from "./snapshot";

// Debugger 10-31: the dock showed "Capital One 360 could drop to -$449.25 around Nov 3" twice, as
// the low-balance finding's card and as the alert's heads-up. Said once, under the finding, as
// the weekly email does (src/lib/digest/build.ts).

const LOW = "Capital One 360 could drop to -$449.25 around Nov 3";
const finding = { findingId: "f1", type: "low_balance_risk", title: LOW } as SnapshotFinding;
const alert = { id: "a1", title: `${LOW}.`, body: "That's from your balance today and the bills." };
const snapshot = (findings: SnapshotFinding[]) =>
  ({
    asOf: "2026-10-30",
    findings,
    deadlines: [],
    budgetsOver: [],
    goalsBehind: [],
    agentSteps: [],
    waitingOnYou: [],
    urgentAlerts: [alert, { id: "a2", title: "A $35.00 overdraft fee", body: "On checking." }],
  }) as unknown as Snapshot;
const alertIds = (s: Snapshot) =>
  headsUpsSource
    .gather(s, {
      now: new Date("2026-10-30T18:00:00Z"),
      local: { date: "2026-10-30", hour: 11 },
      trigger: "sync",
    })
    .flatMap((c) => ("alertId" in c.refs ? [c.refs.alertId] : []));

describe("alert heads-ups", () => {
  it("leave an alert to the open finding that says the same thing", () => {
    expect(alertIds(snapshot([finding]))).toEqual(["a2"]);
  });

  it("say it when no finding does", () => {
    expect(alertIds(snapshot([]))).toEqual(["a1", "a2"]);
  });
});
