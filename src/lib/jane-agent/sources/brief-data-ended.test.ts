import { describe, expect, it } from "vitest";
import type { Candidate } from "../types";
import type { Snapshot } from "../snapshot";
import { agendaOf } from "../agenda";
import { briefSource, dataEndedNotice } from "./brief";

// Coming back to Jane weeks after one upload (debug 3, 11-16): a statement ending Oct 14 gave a
// morning brief on Nov 16 that said "no bills due, nothing waiting" with no sign the data was old.
// The notice used to ride on the safe to spend line; it is its own line now (after #2396).
const NOTICE = "What I have ends on Oct 14, so this may be out of date.";
const NOW = new Date("2026-11-16T17:00:00Z");
const local = { date: "2026-11-16", hour: 9, minute: 0 } as never;

const snapshot = (dataEnded: string | null) =>
  ({
    dataEnded,
    safeToSpend: { safeCents: 546_872, payday: null },
    comingUp: [],
    waitingOnYou: [],
    findings: [],
    plan: { items: 0, annualSavingsCents: 0, safeItems: 0 },
    deadlines: [],
    budgetsOver: [],
    goalsBehind: [],
    urgentAlerts: [],
    agentSteps: [],
    assetPrompts: [],
    lastRun: null,
  }) as unknown as Snapshot;

const brief = (dataEnded: string | null) => {
  const [msg] = briefSource.gather(snapshot(dataEnded), { now: NOW, local, trigger: "open" });
  return msg!.body.split("\n");
};

describe("the brief after old statements", () => {
  it("says on its own line that the data ends weeks ago, even with nothing due", () => {
    const lines = brief("2026-10-14");
    expect(lines[0]).toBe("Good morning!");
    expect(lines[1]).toBe(NOTICE);
    expect(lines.some((l) => l.startsWith("No bills due"))).toBe(true);
    expect(lines.join("\n")).not.toMatch(/safe to spend/i);
  });

  it("has no notice while the data is current", () => {
    const lines = brief(null);
    expect(lines.join("\n")).not.toMatch(/out of date|safe to spend/i);
  });

  it("is a line of its own, null when current", () => {
    expect(dataEndedNotice(snapshot("2026-10-14"))).toBe(NOTICE);
    expect(dataEndedNotice(snapshot(null))).toBeNull();
  });
});

describe("the day's agenda after old statements", () => {
  const settled = (dataEnded: string | null) => {
    const snap = snapshot(dataEnded);
    const [first] = briefSource.gather(snap, { now: NOW, local, trigger: "open" });
    const brief = { ...first!, source: "brief" } as Candidate & { source: string };
    return agendaOf(brief, [], snap, local, NOW).agenda.body;
  };

  it("carries the notice on a quiet day, not only a busy one", () => {
    const body = settled("2026-10-14");
    expect(body).toContain("Nothing needs you today.");
    expect(body.split("\n")).toContain(NOTICE);
    expect(body).not.toMatch(/safe to spend/i);
  });

  it("has none while the data is current", () => {
    expect(settled(null)).not.toMatch(/out of date/);
  });
});
