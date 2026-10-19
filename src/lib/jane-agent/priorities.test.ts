import { describe, expect, it } from "vitest";
import { gather, type BrainSettings } from "./brain";
import { parseIntent } from "./intents";
import { priorityItems, rankedFor } from "./priorities";
import { prioritiesReply } from "./replies-priorities";
import type { Snapshot, SnapshotFinding } from "./snapshot";

// Spec step 143 from Jane's snapshot: findings, insurance picks, refinance offers, the
// person's steps and dated deadlines in one list; the brain, the brief and "what should I
// do first?" use it.

const MORNING = new Date("2026-10-19T13:00:00Z");
const SYNC: BrainSettings = { trigger: "sync" };
const finding = (over: Partial<SnapshotFinding>): SnapshotFinding => ({
  findingId: "f1",
  type: "subscription_review",
  title: "Review your Hulu subscription",
  annualSavingsCents: 21_588,
  savings: "Could save about $215.88 a year",
  fingerprint: "fp",
  urgent: false,
  pick: null,
  confidence: "high",
  ...over,
});

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    timezone: "America/New_York",
    asOf: "2026-10-19",
    weekStart: "2026-10-19",
    safeToSpend: null,
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
  } as Snapshot;
}

describe("priorities from the snapshot", () => {
  const busy = snapshot({
    findings: [
      finding({
        findingId: "small",
        title: "Late fee refund",
        annualSavingsCents: 4_000,
        type: "bank_fees",
      }),
      finding({ findingId: "big", title: "Cancel Hulu" }),
      finding({
        findingId: "cash",
        title: "Move idle cash",
        annualSavingsCents: 60_000,
        type: "idle_cash",
      }),
    ],
    agentSteps: [
      {
        actionId: "a1",
        step: "self_cancel",
        title: "Cancel Peacock",
        company: "Peacock",
        todo: "Cancel on Peacock's page",
        url: null,
        switchName: null,
      },
    ] as Snapshot["agentSteps"],
    deadlines: [
      {
        key: "fsa",
        title: "Use your FSA money",
        date: "2026-10-21",
        kind: "fsa",
        source: "entered",
        amountCents: null,
        href: "/deadlines",
        detail: null,
      },
      {
        key: "renew",
        title: "Netflix renews",
        date: "2026-10-20",
        kind: "renewal",
        source: "transactions",
        amountCents: 1_549,
        href: "/subscriptions",
        detail: null,
      },
    ],
  });

  it("brings everything into one ranked list, renewals left out", () => {
    const ranked = rankedFor(busy);
    expect(ranked.map((r) => r.key)).toEqual([
      "deadline:fsa",
      "finding:big",
      "task:a1",
      "finding:cash",
      "finding:small",
    ]);
    expect(priorityItems(busy).some((i) => i.key === "deadline:renew")).toBe(false);
  });

  it("asks about findings in that order, and the brief names the first", () => {
    const messages = gather(busy, MORNING, SYNC);
    const findings = messages.filter((m) => m.source === "findings").map((m) => m.refs.findingId);
    expect(findings).toEqual(["big", "cash", "small"]);
    const brief = messages.find((m) => m.kind === "brief" && m.source === "brief")!;
    expect(brief.body.split("\n").at(-1)).toBe(
      "Start with: Use your FSA money. First because it's due in 2 days and takes about 5 minutes.",
    );
  });

  it("answers 'what should I do first?' with the top three and why", () => {
    expect(parseIntent("What should I do first?", "2026-10-19")).toEqual({ kind: "priorities" });
    const reply = prioritiesReply(rankedFor(busy));
    expect(reply.body.split("\n")).toEqual([
      "These 3 matter most right now.",
      "1. Use your FSA money. First because it's due in 2 days and takes about 5 minutes.",
      "2. Cancel Hulu. Because it saves $215.88 a year and takes one tap.",
      "3. Cancel on Peacock's page. Because my work waits on it and takes about 5 minutes.",
    ]);
    expect(reply.actions.map((a) => ("href" in a ? a.href : ""))).toEqual([
      "/deadlines",
      "/report/big",
      "/actions",
    ]);
    expect(prioritiesReply([]).body).toBe(
      "Nothing needs you right now. I'll tell you here when something does.",
    );
  });
});
