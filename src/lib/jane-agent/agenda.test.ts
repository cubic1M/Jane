import { describe, expect, it } from "vitest";
import { AGENDA_MAX_YES, MESSAGE_PRIORITY } from "@/config/agent-chat";
import { lineOf } from "./agenda";
import { plan, type BrainSettings, type History } from "./brain";
import type { Snapshot, SnapshotFinding } from "./snapshot";
import type { Candidate } from "./types";

// Spec step 184: the day in one message. The brief is the day's agenda; everything less
// urgent waits for it as a line (posted hidden behind it); urgent things still come at once.

// 9am in New York on Oct 19, 2026 (EDT).
const MORNING = new Date("2026-10-19T13:00:00Z");
const LATER = new Date("2026-10-19T18:00:00Z");
const NONE: History = { recent: [], seenKeys: [] };
const AGENDA: BrainSettings = { trigger: "sync", agenda: true };

function finding(over: Partial<SnapshotFinding> = {}): SnapshotFinding {
  return {
    findingId: "f1",
    type: "subscription_review",
    title: "Review your Hulu subscription",
    annualSavingsCents: 21_588,
    savings: "Could save about $215.88 a year",
    fingerprint: "fp1",
    urgent: false,
    pick: null,
    ...over,
  };
}

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    timezone: "America/New_York",
    asOf: "2026-10-19",
    weekStart: "2026-10-19",
    safeToSpend: { safeCents: 123_456, payday: "2026-11-01" },
    comingUp: [],
    waitingOnYou: [],
    findings: [],
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
    ...over,
  };
}

const busy = snapshot({
  findings: [
    finding({ findingId: "hulu", title: "Review your Hulu subscription" }),
    finding({
      findingId: "verizon",
      type: "bill_negotiation",
      title: "Your Verizon bill is above what others pay",
      annualSavingsCents: 30_000,
      savings: "Could save about $300.00 a year",
      fingerprint: "fp2",
    }),
  ],
  comingUp: [
    {
      key: "b1",
      date: "2026-10-20",
      label: "Netflix",
      amountCents: 1_549,
      daysLeft: 1,
      href: "/bills",
    },
  ],
  plan: { items: 2, annualSavingsCents: 51_588, safeItems: 2 },
});

const shown = <T extends { hidden?: boolean }>(messages: T[]) => messages.filter((m) => !m.hidden);

describe("the day's agenda", () => {
  it("is one message: safe to spend, what needs a yes with a Yes each, what's coming up", () => {
    const out = plan(busy, NONE, MORNING, AGENDA);
    const visible = shown(out);
    expect(visible.map((m) => m.kind)).toEqual(["brief"]);
    const [agenda] = visible;
    expect(agenda.body.split("\n")[0]).toBe(
      "Good morning! You have $1,234.56 safe to spend until payday, Nov 1 (in 13 days).",
    );
    expect(agenda.body).toContain("These need your yes:");
    expect(agenda.body).toContain("Coming up: Netflix $15.49 tomorrow.");
    expect(agenda.actions.map((a) => a.id)).toEqual([
      "bundle.1",
      "bundle.2",
      "plan.approve_safe",
      "open",
    ]);
    // Each Yes is that finding's own Yes, on its own message, posted hidden behind the agenda.
    const items = agenda.refs.items!;
    expect(items.map((i) => i.action)).toEqual(["finding.yes", "finding.yes"]);
    const hidden = out.filter((m) => m.hidden);
    expect(hidden.map((m) => m.dedupeKey)).toEqual(
      expect.arrayContaining(items.map((i) => i.dedupeKey)),
    );
  });

  it("says nothing else the rest of the day, unless it's urgent", () => {
    const first = plan(busy, NONE, MORNING, AGENDA);
    const history: History = {
      recent: first.map((m) => ({ kind: m.kind, dedupeKey: m.dedupeKey, createdAt: MORNING })),
      seenKeys: first.map((m) => m.dedupeKey),
    };
    // A new finding later in the day waits for tomorrow's agenda.
    const more = snapshot({
      ...busy,
      findings: [...busy.findings, finding({ findingId: "gym", title: "Review your gym" })],
    });
    expect(plan(more, history, LATER, AGENDA)).toEqual([]);
    // An urgent alert comes at once.
    const urgent = snapshot({
      ...more,
      urgentAlerts: [{ id: "a1", title: "Your checking balance is low", body: "Below $100." }],
    });
    const out = plan(urgent, history, LATER, AGENDA);
    expect(out.map((m) => m.kind)).toEqual(["heads_up"]);
    expect(out[0].priority).toBe(MESSAGE_PRIORITY.urgent_alert);
  });

  it("is one short line on a day with nothing to do", () => {
    const [agenda, ...rest] = plan(snapshot(), NONE, MORNING, AGENDA);
    expect(rest).toEqual([]);
    expect(agenda.body).toBe(
      "Good morning! Nothing needs you today. You have $1,234.56 safe to spend until payday, Nov 1 (in 13 days).",
    );
    expect(agenda.actions.map((a) => a.id)).toEqual(["open"]);
  });

  it("says what Jane did overnight", () => {
    const [agenda] = plan(
      snapshot({
        ...busy,
        lastRun: {
          day: "2026-10-19",
          finishedAt: MORNING,
          steps: [
            { step: "sync", status: "ok", did: "Synced 2 accounts.", changed: 0, ms: 10 },
            {
              step: "insurance",
              status: "ok",
              did: "Found a cheaper car policy.",
              changed: 1,
              ms: 10,
            },
          ],
        },
      }),
      NONE,
      MORNING,
      AGENDA,
    );
    expect(agenda.body.split("\n")[1]).toBe(
      "Overnight I checked 2 areas: Found a cheaper car policy.",
    );
  });

  it(`lists at most ${AGENDA_MAX_YES} things to say yes to; the rest wait for tomorrow`, () => {
    const many = snapshot({
      findings: Array.from({ length: AGENDA_MAX_YES + 2 }, (_, i) =>
        finding({ findingId: `f${i}`, title: `Review your Service ${i} subscription` }),
      ),
    });
    const out = plan(many, NONE, MORNING, AGENDA);
    expect(out[0].refs.items).toHaveLength(AGENDA_MAX_YES);
    expect(out.filter((m) => m.hidden)).toHaveLength(AGENDA_MAX_YES);
  });

  it("leaves each thing as its own message when the agenda is off", () => {
    const out = plan(busy, NONE, MORNING, { trigger: "sync" });
    expect(out.filter((m) => m.kind === "decision").length).toBeGreaterThan(0);
    expect(out.some((m) => m.hidden)).toBe(false);
  });
});

describe("an agenda line", () => {
  const candidate = (body: string): Candidate => ({
    kind: "decision",
    body,
    refs: {},
    actions: [],
    dedupeKey: "k",
    priority: 1,
  });

  it("drops the question that asks for the tap", () => {
    expect(lineOf(candidate("Charged twice? $64.20 at Target. Want me to handle it?"))).toBe(
      "Charged twice? $64.20 at Target.",
    );
    expect(lineOf(candidate("Netflix went up from $15.49 to $17.99.\nMore."))).toBe(
      "Netflix went up from $15.49 to $17.99.",
    );
  });
});
