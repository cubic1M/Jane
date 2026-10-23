import { describe, expect, it } from "vitest";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { UpkeepSnapshot } from "@/lib/plan-upkeep";
import { gather, plan, type BrainSettings } from "./brain";
import { weeklyReview } from "./replies-review";
import type { Snapshot } from "./snapshot";

// Spec step 101: the budget tune-up and transfers in the chat, and the weekly review: what
// Jane did, what it saved, what's next and one decision at most, as an answer and as the
// Monday brief's "Last week" line.

// Sunday Oct 25, 2026, 6pm in New York, the last day of the week of Oct 19.
const SUNDAY = new Date("2026-10-25T22:00:00Z");
// Monday Oct 26, 9am in New York: the first day of the next week.
const MONDAY = new Date("2026-10-26T13:00:00Z");
const SYNC: BrainSettings = { trigger: "sync" };
const DAY = 24 * 60 * 60 * 1000;

const upkeep = (over: Partial<UpkeepSnapshot> = {}): UpkeepSnapshot => ({
  tuneUp: null,
  transfers: [],
  counted: [],
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
    autopilot: "ask",
    setupProposals: [],
    agentSteps: [],
    assetPrompts: [],
    ...over,
  };
}
const from = (s: Snapshot, source: string, now = SUNDAY) =>
  gather(s, now, SYNC).filter((m) => m.source === source);
const ids = (m: { actions: { id: string }[] }) => m.actions.map((a) => a.id);
const TUNE = {
  month: "2026-11",
  changes: [
    { category: "Food and drink", fromCents: 40_000, toCents: 47_000 },
    { category: "Shopping", fromCents: 20_000, toCents: 15_000 },
  ],
};

describe("the upkeep source", () => {
  it("asks about a tune-up with Accept all, Keep and Change", () => {
    const [m] = from(
      snapshot({ upkeep: upkeep({ tuneUp: { ...TUNE, status: "proposed" } }) }),
      "upkeep",
    );
    expect(m).toMatchObject({
      kind: "decision",
      body: "Budget tune-up for November, from what you usually spend: Food and drink $400.00 → $470.00; Shopping $200.00 → $150.00.",
      refs: { tuneUpMonth: "2026-11" },
      dedupeKey: "upkeep:tuneup:2026-11",
      priority: MESSAGE_PRIORITY.upkeep,
    });
    expect(ids(m)).toEqual(["tuneup.accept", "tuneup.keep", "open"]);
  });

  it("says what autopilot changed, with Undo, and nothing once it's answered", () => {
    const [m] = from(
      snapshot({ upkeep: upkeep({ tuneUp: { ...TUNE, status: "auto" } }) }),
      "upkeep",
    );
    expect(m.kind).toBe("done");
    expect(m.body).toMatch(
      /^I tuned your budgets for November to what you usually spend \(autopilot\)/,
    );
    expect(ids(m)).toEqual(["tuneup.undo", "open"]);
    for (const status of ["accepted", "kept", "undone"]) {
      expect(from(snapshot({ upkeep: upkeep({ tuneUp: { ...TUNE, status } }) }), "upkeep")).toEqual(
        [],
      );
    }
  });

  it("asks to count a transfer, or says autopilot counted it", () => {
    const transfer = {
      transactionId: "t1",
      amountCents: 25_000,
      date: "2026-10-01",
      goal: { id: "g1", name: "Trip" },
    };
    const [ask] = from(snapshot({ upkeep: upkeep({ transfers: [transfer] }) }), "upkeep");
    expect(ask.body).toBe(
      'You moved $250.00 to savings on Oct 1. Count it toward your goal "Trip"?',
    );
    expect(ids(ask)).toEqual(["transfer.count", "transfer.skip"]);
    const counted = {
      transactionId: "t1",
      amountCents: 25_000,
      goalName: "Trip",
      savedCents: 125_000,
      targetCents: 300_000,
    };
    const [done] = from(snapshot({ upkeep: upkeep({ counted: [counted] }) }), "upkeep");
    expect(done.body).toBe(
      'I counted the $250.00 you moved to savings toward "Trip" (autopilot). That\'s $1,250.00 of $3,000.00.',
    );
  });
});

describe("the weekly review", () => {
  const finding = {
    findingId: "f1",
    type: "price_increase" as const,
    title: "Netflix went up from $15.49 to $17.99",
    annualSavingsCents: 3000,
    savings: "Could save about $30.00 a year",
    fingerprint: "fp1",
    urgent: false,
    pick: null,
  };

  it("says what Jane did, what it saved, what's next and one decision", () => {
    const s = snapshot({
      finished: [
        {
          actionId: "a1",
          title: "Refund the overdraft fee",
          confirmedCents: 3400,
          completedAt: new Date(SUNDAY.getTime() - 2 * DAY),
        },
        // Last month: not this week.
        {
          actionId: "a0",
          title: "Old",
          confirmedCents: 999,
          completedAt: new Date(SUNDAY.getTime() - 30 * DAY),
        },
      ],
      ruleApprovals: [
        {
          decisionId: "d1",
          title: "x",
          ruleLabel: "r",
          createdAt: new Date(SUNDAY.getTime() - DAY),
          canUndo: false,
        },
      ],
      comingUp: [
        {
          label: "Rent",
          amountCents: 180_000,
          daysLeft: 3,
          href: "/bills",
        } as Snapshot["comingUp"][number],
      ],
      plan: { items: 2, annualSavingsCents: 3000, safeItems: 1 },
      findings: [finding, { ...finding, findingId: "f2" }],
      upkeep: upkeep({ tuneUp: { ...TUNE, status: "auto" } }),
    });
    const m = weeklyReview(s, SUNDAY);
    expect(m.refs).toEqual({ findingId: "f1", fingerprint: "fp1" });
    expect(m.body).toBe(
      [
        "Here's your week with Jane.",
        '- Done: I finished 1 thing ("Refund the overdraft fee"); said yes to 1 thing under your rules; tuned your budgets for the month.',
        "- Saved: $34.00 back or agreed.",
        "- Next week: 1 bill due, 2 things on your plan.",
        "- One to decide: Netflix went up from $15.49 to $17.99. Could save about $30.00 a year.",
      ].join("\n"),
    );
    // One decision at most.
    expect(ids(m)).toEqual(["finding.yes", "finding.no", "open"]);
  });

  it("is never a message of its own: the Monday brief says how the week went", () => {
    // Merged into the brief (docs/feature-audit.md, cluster 2), with the week's summary
    // (spec step 96).
    const sources = new Set(gather(snapshot(), SUNDAY, SYNC).map((m) => m.source));
    expect(sources.has("review")).toBe(false);
    expect(sources.has("week")).toBe(false);
    const s = snapshot({
      weekStart: "2026-10-26",
      finished: [
        {
          actionId: "a1",
          title: "Refund the overdraft fee",
          confirmedCents: 3400,
          completedAt: new Date(MONDAY.getTime() - 2 * DAY),
        },
      ],
      ruleApprovals: [
        {
          decisionId: "d1",
          title: "x",
          ruleLabel: "r",
          createdAt: new Date(MONDAY.getTime() - DAY),
          canUndo: false,
        },
      ],
      lastWeek: { start: "2026-10-19", asked: 5, yes: 2, no: 1, done: 1 },
    });
    const line =
      'The week of Oct 19: I finished 1 thing ("Refund the overdraft fee"); said yes to 1 thing under your rules; $34.00 came back or agreed; we covered 5 questions you asked and 3 decisions (2 yes, 1 no).';
    const [brief] = from(s, "brief", MONDAY);
    expect(brief.body.split("\n")).toContain(line);
    // The day as one agenda message (spec step 184) carries it too.
    const [agenda] = plan(s, { recent: [], seenKeys: [] }, MONDAY, { ...SYNC, agenda: true });
    expect(agenda.source).toBe("brief");
    expect(agenda.body.split("\n")).toContain(line);
    // Only on the first day of the week.
    const [tuesday] = from(s, "brief", new Date(MONDAY.getTime() + DAY));
    expect(tuesday.body).not.toContain("The week of");
  });

  it("leaves the brief alone after a week with nothing in it", () => {
    const quiet = snapshot({
      weekStart: "2026-10-26",
      lastWeek: { start: "2026-10-19", asked: 0, yes: 0, no: 0, done: 0 },
    });
    const [brief] = from(quiet, "brief", MONDAY);
    expect(brief.body).not.toContain("The week of");
    expect(brief.body).not.toContain("Last week");
  });

  it("says so plainly in a quiet week, with no decision", () => {
    const review = weeklyReview(snapshot(), SUNDAY);
    expect(review.body).toBe(
      [
        "Here's your week with Jane.",
        "- Done: nothing finished this week. I'm still watching.",
        "- Saved: nothing back or agreed yet this week.",
        "- Next week: nothing due that I know of.",
      ].join("\n"),
    );
    expect(review.actions.map((a) => a.id)).toEqual(["open"]);
    expect(review.refs).toEqual({});
  });
});
