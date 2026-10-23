import { describe, expect, it } from "vitest";
import { CHAT_DAILY_LIMIT, CHAT_SOURCE_LIMITS, MESSAGE_PRIORITY } from "@/config/agent-chat";
import { gather, plan, type BrainSettings, type History } from "./brain";
import type { Snapshot, SnapshotFinding } from "./snapshot";

// Spec step 82: Jane's brain, source by source, then its limits: quiet hours in the
// person's timezone, never the same thing twice, a daily cap, the most important first.

// 9am in New York on Oct 19, 2026 (EDT).
const MORNING = new Date("2026-10-19T13:00:00Z");
const NONE: History = { recent: [], seenKeys: [] };
const OPEN: BrainSettings = { trigger: "open" };
const SYNC: BrainSettings = { trigger: "sync" };

function finding(over: Partial<SnapshotFinding> = {}): SnapshotFinding {
  return {
    findingId: "f1",
    type: "price_increase",
    title: "Netflix went up",
    annualSavingsCents: 3_600,
    savings: "Could save about $36.00 a year",
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
    // Spec step 83's sources stay quiet here (./sources-more.test.ts covers them).
    budgetProgress: [],
    autopilot: "safe",
    setupProposals: [],
    agentSteps: [],
    assetPrompts: [],
    ...over,
  };
}

const keys = (messages: { dedupeKey: string }[]) => messages.map((m) => m.dedupeKey);
const bySource = (s: Snapshot, source: string, now = MORNING, settings = SYNC) =>
  gather(s, now, settings).filter((m) => m.source === source);

describe("the morning brief", () => {
  it("says what's safe to spend, the bills due in two days and what's waiting", () => {
    const [brief] = bySource(
      snapshot({
        safeToSpend: { safeCents: 123_456, payday: "2026-10-30" },
        comingUp: [
          {
            key: "b1",
            date: "2026-10-20",
            label: "Netflix",
            amountCents: 1_549,
            daysLeft: 1,
            href: "/bills",
          },
          {
            key: "b2",
            date: "2026-10-25",
            label: "Rent",
            amountCents: 200_000,
            daysLeft: 6,
            href: "/bills",
          },
          {
            key: "d1",
            date: "2026-10-19",
            label: "FSA deadline",
            amountCents: null,
            daysLeft: 0,
            href: "/deadlines",
          },
        ],
        plan: { items: 2, annualSavingsCents: 10_000, safeItems: 1 },
        waitingOnYou: [{ id: "a1", title: "Gym refund", todo: "Sign the form" }],
      }),
      "brief",
    );
    expect(brief).toMatchObject({ kind: "brief", dedupeKey: "brief:2026-10-19" });
    expect(brief.body).toBe(
      [
        "Good morning!",
        "You have $1,234.56 safe to spend until payday, Oct 30 (in 11 days).",
        "Bills due soon: Netflix $15.49 tomorrow.",
        "3 things are waiting for you.",
      ].join("\n"),
    );
  });

  it("says when money is short, and when nothing is due or waiting", () => {
    const [brief] = bySource(
      snapshot({ safeToSpend: { safeCents: -5_000, payday: null } }),
      "brief",
    );
    expect(brief.body).toContain("You're short by $50.00 this month, after your bills.");
    expect(brief.body).toContain("No bills due in the next 2 days.");
    expect(brief.body).toContain("Nothing is waiting on you.");
  });

  it("waits until 7am local time, unless the person opens the chat", () => {
    // 6:30am in New York.
    const early = new Date("2026-10-19T10:30:00Z");
    expect(bySource(snapshot(), "brief", early, SYNC)).toEqual([]);
    expect(bySource(snapshot(), "brief", early, OPEN)).toHaveLength(1);
    // 7am.
    expect(bySource(snapshot(), "brief", new Date("2026-10-19T11:00:00Z"), SYNC)).toHaveLength(1);
  });

  it("is once a day, in the person's own day", () => {
    // 11pm Oct 18 in Los Angeles is already Oct 19 in UTC.
    const late = new Date("2026-10-19T06:00:00Z");
    const [brief] = bySource(snapshot({ timezone: "America/Los_Angeles" }), "brief", late, OPEN);
    expect(brief.dedupeKey).toBe("brief:2026-10-18");
    expect(brief.body.startsWith("Good evening!")).toBe(true);
  });
});

describe("findings worth deciding", () => {
  it("offers each open finding with Yes, No and Open, the biggest saving first", () => {
    const messages = bySource(
      snapshot({
        findings: [
          finding({ findingId: "small", annualSavingsCents: 1_000 }),
          finding({ findingId: "none", annualSavingsCents: null }),
          finding({ findingId: "big", annualSavingsCents: 50_000 }),
        ],
      }),
      "findings",
    );
    expect(keys(messages)).toEqual(["findings:big", "findings:small", "findings:none"]);
    expect(messages[0]).toMatchObject({
      kind: "decision",
      body: "Netflix went up. Could save about $36.00 a year. Want me to handle it?",
      refs: { findingId: "big", fingerprint: "fp1" },
      actions: [
        { id: "finding.yes", label: "Yes", kind: "primary" },
        { id: "finding.no", label: "No", kind: "secondary" },
        // Spec step 90: a quick reply, answered in the chat.
        { id: "finding.why", label: "Why?", kind: "quick" },
        { id: "suggest.never", label: "Don't suggest again", kind: "secondary" },
        { id: "open", label: "Open", kind: "link", href: "/report/big" },
      ],
      priority: MESSAGE_PRIORITY.finding,
    });
  });

  it("adds Jane's pick as its own button when the options were compared", () => {
    const [message] = bySource(
      snapshot({
        findings: [
          finding({
            type: "bill_negotiation",
            title: "Verizon Wireless phone bill",
            pick: {
              optionId: "opt_pine",
              name: "Pine Mobile",
              savingCents: 24_000,
              savings: false,
            },
          }),
        ],
      }),
      "findings",
    );
    expect(message.body).toContain(
      "My pick: Pine Mobile, which saves about $240.00 in the first year.",
    );
    expect(message.refs.pickOptionId).toBe("opt_pine");
    expect(message.actions.map((a) => a.label)).toEqual([
      "Yes",
      "Switch to Pine Mobile",
      "No",
      "Why?",
      "Show options",
      "Don't suggest again",
      "Open",
    ]);
  });

  it("ranks time-sensitive findings higher", () => {
    const [message] = bySource(snapshot({ findings: [finding({ urgent: true })] }), "findings");
    expect(message.priority).toBe(MESSAGE_PRIORITY.urgent_finding);
  });
});

describe("the week's plan", () => {
  it("says nothing with an empty plan", () => {
    expect(bySource(snapshot(), "plan")).toEqual([]);
  });

  it("sums up the week, offering Approve all safe ones when some are safe", () => {
    const [message] = bySource(
      snapshot({ plan: { items: 4, annualSavingsCents: 52_000, safeItems: 2 } }),
      "plan",
    );
    expect(message).toMatchObject({
      kind: "decision",
      dedupeKey: "plan:2026-10-19",
      body: "Your plan for this week is ready: 4 things, worth up to $520.00 a year if you say yes to all. 2 of them are safe for me to just do; the rest need a look from you.",
      actions: [
        { id: "plan.approve_safe", label: "Approve all safe ones", kind: "primary" },
        { id: "open", label: "Review", kind: "link", href: "/plan" },
      ],
    });
  });

  it("only offers Review when nothing is safe to just do", () => {
    const [message] = bySource(
      snapshot({ plan: { items: 1, annualSavingsCents: 0, safeItems: 0 } }),
      "plan",
    );
    expect(message.body).toBe(
      "Your plan for this week is ready: 1 thing. Each one needs a look from you.",
    );
    expect(message.actions.map((a) => a.id)).toEqual(["open"]);
  });
});

describe("I did this", () => {
  const approval = {
    decisionId: "d1",
    title: "Bank fee refund",
    ruleLabel: "Always dispute bank fees",
    createdAt: new Date("2026-10-19T12:00:00Z"),
    canUndo: true,
  };

  it("tells about a rule's yes, with Undo for a day", () => {
    const [message] = bySource(snapshot({ ruleApprovals: [approval] }), "did");
    expect(message).toMatchObject({
      kind: "done",
      dedupeKey: "did:rule:d1",
      refs: { decisionId: "d1", undoUntil: "2026-10-20T12:00:00.000Z" },
    });
    expect(message.actions.map((a) => a.id)).toEqual(["undo.rule", "open"]);
  });

  it("leaves Undo off once the work started or the day is over", () => {
    const started = bySource(snapshot({ ruleApprovals: [{ ...approval, canUndo: false }] }), "did");
    expect(started[0].actions.map((a) => a.id)).toEqual(["open"]);
    const dayLater = bySource(
      snapshot({ ruleApprovals: [approval] }),
      "did",
      new Date("2026-10-20T12:00:01Z"),
    );
    expect(dayLater[0].actions.map((a) => a.id)).toEqual(["open"]);
  });

  it("tells about finished work from the last week, with what was confirmed", () => {
    const messages = bySource(
      snapshot({
        finished: [
          {
            actionId: "a1",
            title: "Charged twice at Target",
            confirmedCents: 6_420,
            completedAt: new Date("2026-10-18T10:00:00Z"),
          },
          {
            actionId: "a2",
            title: "Old",
            confirmedCents: null,
            completedAt: new Date("2026-10-01T10:00:00Z"),
          },
        ],
      }),
      "did",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: "done",
      body: 'Done: "Charged twice at Target". $64.20 back or agreed.',
      dedupeKey: "did:action:a1",
    });
  });
});

describe("heads-ups", () => {
  it("covers urgent alerts, deadlines within 3 days, waiting actions, budgets and goals", () => {
    const messages = bySource(
      snapshot({
        urgentAlerts: [
          { id: "al1", title: "Low balance ahead", body: "Checking may run short Friday." },
        ],
        deadlines: [
          {
            key: "k1",
            title: "Netflix renews",
            date: "2026-10-21",
            kind: "renewal",
            source: "transactions",
            amountCents: 1_549,
            href: "/subscriptions",
            detail: null,
          },
          {
            key: "k2",
            title: "FSA deadline",
            date: "2026-10-30",
            kind: "fsa",
            source: "entered",
            amountCents: null,
            href: null,
            detail: null,
          },
          {
            key: "k3",
            title: "Past",
            date: "2026-10-18",
            kind: "other",
            source: "entered",
            amountCents: null,
            href: null,
            detail: null,
          },
        ],
        waitingOnYou: [{ id: "a1", title: "Gym refund", todo: "Sign the form." }],
        budgetsOver: [{ category: "Food and drink", overCents: 4_200, month: "2026-10" }],
        goalsBehind: [{ id: "g1", name: "Trip", leftCents: 50_000 }],
      }),
      "heads_ups",
    );
    expect(messages.map((m) => [m.dedupeKey, m.body])).toEqual([
      ["heads_ups:alert:al1", "Low balance ahead. Checking may run short Friday."],
      ["heads_ups:deadline:k1", "Coming up in 2 days: Netflix renews ($15.49)."],
      ["heads_ups:waiting:a1", 'I need you for one step on "Gym refund": Sign the form.'],
      [
        "heads_ups:budget:Food and drink:2026-10",
        "You've gone over your Food and drink budget this month, by $42.00.",
      ],
      [
        "heads_ups:goal:g1",
        'Your goal "Trip" reached its date with $500.00 still to go. You can pick a new date.',
      ],
    ]);
    expect(messages.every((m) => m.kind === "heads_up")).toBe(true);
    expect(messages[1].actions).toEqual([
      { id: "snooze", label: "Remind me tomorrow", kind: "secondary" },
      { id: "open", label: "Open", kind: "link", href: "/subscriptions" },
    ]);
  });
});

describe("plan (the limits)", () => {
  const busy = snapshot({
    // Each of a different kind, so none go together in one message (spec step 92).
    findings: (
      [
        "price_increase",
        "bank_fees",
        "subscription_review",
        "bill_negotiation",
        "idle_cash",
        "card_interest",
      ] as const
    ).map((type, i) => finding({ findingId: `f${i}`, type, annualSavingsCents: 1_000 * (6 - i) })),
    plan: { items: 6, annualSavingsCents: 21_000, safeItems: 3 },
    urgentAlerts: [
      { id: "al1", title: "A", body: "a" },
      { id: "al2", title: "B", body: "b" },
      { id: "al3", title: "C", body: "c" },
    ],
  });

  it("posts the brief first, then the most important, within the daily and source limits", () => {
    const out = plan(busy, NONE, MORNING, SYNC);
    expect(keys(out)).toEqual([
      "brief:2026-10-19",
      "heads_ups:alert:al1",
      "heads_ups:alert:al2",
      "plan:2026-10-19",
      "findings:f0",
      "findings:f1",
    ]);
    expect(out.length - 1).toBe(CHAT_DAILY_LIMIT);
    expect(CHAT_SOURCE_LIMITS.heads_ups).toBe(2);
  });

  it("never posts the same thing twice", () => {
    const first = plan(busy, NONE, MORNING, SYNC);
    const later = new Date(MORNING.getTime() + 60 * 60 * 1000);
    const second = plan(busy, { recent: [], seenKeys: keys(first) }, later, {
      ...SYNC,
      dailyLimit: 100,
    });
    expect(keys(second).some((k) => keys(first).includes(k))).toBe(false);
  });

  it("counts what was already posted today against the day's limit", () => {
    const recent = ["heads_ups:alert:x", "findings:x1", "findings:x2", "plan:old"].map(
      (dedupeKey) => ({
        kind: "decision",
        dedupeKey,
        createdAt: new Date("2026-10-19T12:30:00Z"),
      }),
    );
    const out = plan(busy, { recent, seenKeys: [] }, MORNING, SYNC);
    // One left today: one heads-up (one of two used), no plan (its one used), one finding.
    expect(keys(out)).toEqual(["brief:2026-10-19", "heads_ups:alert:al1"]);
  });

  it("starts a new day at the person's midnight, not UTC's", () => {
    // Posted at 11pm Oct 18 in New York (Oct 19 in UTC): yesterday for them.
    const recent = Array.from({ length: CHAT_DAILY_LIMIT }, (_, i) => ({
      kind: "decision",
      dedupeKey: `findings:old${i}`,
      createdAt: new Date("2026-10-19T03:00:00Z"),
    }));
    expect(plan(busy, { recent, seenKeys: [] }, MORNING, SYNC)).toHaveLength(CHAT_DAILY_LIMIT + 1);
  });

  it("doesn't count what the person typed or Jane's answers to it", () => {
    const recent = Array.from({ length: 10 }, (_, i) => ({
      kind: i % 2 ? "user" : "reply",
      dedupeKey: `ask:${i}`,
      createdAt: MORNING,
    }));
    expect(plan(busy, { recent, seenKeys: [] }, MORNING, SYNC)).toHaveLength(CHAT_DAILY_LIMIT + 1);
  });

  it("says nothing in quiet hours, 9pm to 8am in the person's timezone", () => {
    // 10pm in New York, but 7pm in Los Angeles.
    const night = new Date("2026-10-20T02:00:00Z");
    expect(plan(busy, NONE, night, SYNC)).toEqual([]);
    expect(plan(busy, NONE, night, { trigger: "cron" })).toEqual([]);
    expect(
      plan({ ...busy, timezone: "America/Los_Angeles" }, NONE, night, SYNC).length,
    ).toBeGreaterThan(0);
    // 7:30am in New York: after the brief's 7am, still quiet.
    expect(plan(busy, NONE, new Date("2026-10-19T11:30:00Z"), SYNC)).toEqual([]);
  });

  it("still answers when the person opens the chat in quiet hours", () => {
    const night = new Date("2026-10-20T02:00:00Z");
    const out = plan(busy, NONE, night, OPEN);
    expect(out[0].kind).toBe("brief");
    expect(out.length).toBe(CHAT_DAILY_LIMIT + 1);
  });

  it("takes other limits and sources from the settings", () => {
    const out = plan(busy, NONE, MORNING, {
      ...SYNC,
      dailyLimit: 1,
      sourceLimits: { findings: 5 },
      quietHours: { start: 0, end: 0 },
    });
    expect(keys(out)).toEqual(["brief:2026-10-19", "heads_ups:alert:al1"]);
    const custom = plan(busy, NONE, MORNING, {
      ...SYNC,
      sources: [
        {
          key: "hello",
          gather: () => [
            { kind: "heads_up", body: "Hi", refs: {}, actions: [], dedupeKey: "x", priority: 1 },
          ],
        },
      ],
    });
    expect(keys(custom)).toEqual(["hello:x"]);
  });
});

// Spec step 92: related suggestions become one message with a list and a Yes each, which
// counts as one toward the day; the findings behind it are posted hidden, so they never come
// on their own later.
describe("bundles", () => {
  const subs = ["Netflix", "Hulu", "Peacock"].map((name, i) =>
    finding({
      findingId: `s${i}`,
      type: "subscription_review",
      title: `Review your ${name} subscription`,
      annualSavingsCents: 10_000 - i * 1_000,
      savings: `Could save about $${100 - i * 10}.00 a year`,
    }),
  );

  it("puts findings of one kind in one message, a Yes each, in the first one's place", () => {
    const out = plan(
      snapshot({ findings: [...subs, finding({ findingId: "p1" })] }),
      NONE,
      MORNING,
      {
        ...SYNC,
        dailyLimit: 2,
      },
    );
    const shown = out.filter((m) => !m.hidden);
    expect(shown.map((m) => m.kind)).toEqual(["brief", "decision", "decision"]);
    const bundle = shown[1];
    expect(bundle.dedupeKey).toMatch(/^findings:bundle:/);
    expect(bundle.body).toBe(
      [
        "I found 3 subscriptions you could cancel, about $270.00 a year in all.",
        "- Review your Netflix subscription: could save about $100.00 a year",
        "- Review your Hulu subscription: could save about $90.00 a year",
        "- Review your Peacock subscription: could save about $80.00 a year",
        "Want me to handle any of them?",
      ].join("\n"),
    );
    expect(bundle.actions.map((a) => a.label)).toEqual([
      "Yes: Netflix",
      "Yes: Hulu",
      "Yes: Peacock",
      "Review the plan",
    ]);
    expect(bundle.refs.items?.map((i) => i.dedupeKey)).toEqual([
      "findings:s0",
      "findings:s1",
      "findings:s2",
    ]);
    // The three findings, hidden behind it; the price rise on its own.
    expect(keys(out.filter((m) => m.hidden))).toEqual([
      "findings:s0",
      "findings:s1",
      "findings:s2",
    ]);
    expect(shown[2].dedupeKey).toBe("findings:p1");
  });

  it("leaves a kind of one on its own, and never re-bundles what was posted", () => {
    expect(plan(snapshot({ findings: [subs[0]] }), NONE, MORNING, SYNC).some((m) => m.hidden)).toBe(
      false,
    );
    const again = plan(
      snapshot({ findings: subs }),
      { recent: [], seenKeys: ["findings:s0", "findings:s1"] },
      MORNING,
      SYNC,
    );
    expect(keys(again).filter((k) => k.startsWith("findings:"))).toEqual(["findings:s2"]);
  });
});

describe("taxes speak once a month unless it's urgent (spec step 273)", () => {
  const taxes = {
    key: "taxes",
    gather: () =>
      [40, 55, 85].map((priority) => ({
        kind: "heads_up" as const,
        body: `p${priority}`,
        refs: {},
        actions: [],
        dedupeKey: `p${priority}`,
        priority,
      })),
  };
  const run = (thisMonth?: Record<string, number>) =>
    keys(
      plan(snapshot(), { ...NONE, thisMonth }, MORNING, {
        ...SYNC,
        sources: [taxes],
        sourceLimits: { taxes: 5 },
      }),
    );

  it("posts the most important one that isn't urgent, and whatever is urgent", () => {
    expect(run({ taxes: 0 })).toEqual(["taxes:p85", "taxes:p55"]);
  });

  it("posts only what's urgent once this month's one is out", () => {
    expect(run({ taxes: 1 })).toEqual(["taxes:p85"]);
  });

  it("still asks a question the person answers to keep their figures right", () => {
    const asking = {
      key: "taxes",
      gather: () => [
        {
          kind: "decision" as const,
          body: "Add it?",
          refs: { incomeKind: "self_employed" },
          actions: [],
          dedupeKey: "income",
          priority: 36,
        },
      ],
    };
    const out = plan(snapshot(), { ...NONE, thisMonth: { taxes: 1 } }, MORNING, {
      ...SYNC,
      sources: [asking],
      sourceLimits: { taxes: 5 },
    });
    expect(keys(out)).toEqual(["taxes:income"]);
  });

  it("doesn't limit when the month isn't counted", () => {
    expect(run()).toEqual(["taxes:p85", "taxes:p55", "taxes:p40"]);
  });
});
