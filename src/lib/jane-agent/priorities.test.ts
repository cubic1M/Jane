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

describe("refunds in the priorities", () => {
  it("reads a double charge as money back once, not a year", () => {
    const items = priorityItems(
      snapshot({
        findings: [
          finding({
            findingId: "dup",
            type: "duplicate_charge",
            title: "Charged twice? $64.20 at Target",
            annualSavingsCents: 6_420,
          }),
        ],
      }),
    );
    expect(items[0].once).toBe(true);
    expect(
      rankedFor(snapshot({ findings: [finding({ type: "duplicate_charge" })] }))[0].why,
    ).toMatch(/gets the most back \(\$215\.88\)/);
  });
});

// One ranked list (docs/feature-audit.md, cluster 8): the nightly scan's suggestions lead it,
// so the brief, /jane, the monthly report and the chat all name the same first thing.
describe("the one ranked list", () => {
  const suggestion = {
    id: "s1",
    key: "idle_cash",
    topic: "cash",
    title: "Move idle cash to higher interest",
    headline: "Move idle cash to higher interest, earn $360 a year",
    short: "You keep $9,000 in cash; about $8,000 is more than you need",
    why: "You keep $9,000 in checking.",
    worthCents: 36_000,
    worthKind: "yearly",
    confidencePercent: 85,
    confidenceReason: "12 months of balances",
    actionLabel: "Move it",
    actionHref: "/report/cash1",
    more: [],
    advice: false,
  };
  const withScan = snapshot({
    suggestions: [suggestion],
    findings: [
      finding({ findingId: "f1", annualSavingsCents: 90_000 }),
      // The finding the suggestion opens: listed once, as the suggestion.
      finding({ findingId: "cash1", title: "Idle cash", type: "idle_cash" }),
    ],
  });

  it("leads with the scan's suggestions, then the rest without repeats", () => {
    const ranked = rankedFor(withScan);
    expect(ranked.map((r) => r.key)).toEqual(["suggestion:idle_cash", "finding:f1"]);
    expect(ranked[0]).toMatchObject({
      kind: "suggestion",
      href: "/report/cash1",
      valueCents: 36_000,
      sure: { percent: 85, reason: "12 months of balances" },
      confidence: "high",
      why: "You keep $9,000 in cash; about $8,000 is more than you need. 85% sure: 12 months of balances.",
    });
    // Second now, though the biggest saving of the rest.
    expect(ranked[1].why).toMatch(/^Because /);
    // With no suggestions, step 143's order as before.
    expect(rankedFor(snapshot({ findings: withScan.findings }))[0].why).toMatch(/^First because/);
  });

  it("is what the brief starts with and what 'what should I do first' answers", () => {
    const [brief] = gather(withScan, MORNING, SYNC).filter((m) => m.source === "brief");
    expect(brief.body).toContain(
      "Start with: Move idle cash to higher interest. You keep $9,000 in cash; about $8,000 is more than you need. 85% sure: 12 months of balances.",
    );
    const one = prioritiesReply(rankedFor(withScan), false, true);
    expect(one.body).toMatch(/^Move idle cash to higher interest\. You keep \$9,000/);
    expect(one.body).toContain("It's worth about $360.00 a year.");
    const why = prioritiesReply(rankedFor(withScan), true);
    expect(why.body).toMatch(
      /^Move idle cash to higher interest is first: it's the best thing I found looking across your money\./,
    );
    const risk = rankedFor(
      snapshot({ suggestions: [{ ...suggestion, worthKind: "risk", worthCents: 50_000 }] }),
    );
    expect(prioritiesReply(risk, false, true).body).toContain(
      "It could spare you a loss of about $500.00.",
    );
  });
});
