import { describe, expect, it } from "vitest";
import { CHAT_DAILY_LIMIT, CHAT_SOURCE_LIMITS, MESSAGE_PRIORITY } from "@/config/agent-chat";
import { AUTOPILOT_LEVELS } from "@/config/autopilot";
import { stepOf } from "./agent-steps";
import { gather, plan, type BrainSettings, type History } from "./brain";
import type { Snapshot } from "./snapshot";
import type { SnapshotAgentStep } from "./snapshot-more";
import { startOfTomorrow } from "./snooze";

// Spec step 83: the rest of Jane from the chat. Each new source posts when it should,
// stays quiet when it shouldn't and never says the same thing twice; the heads-ups gain
// their buttons; "Not now" hides a message until tomorrow, then lets it back.

// 9am in New York on Oct 19, 2026 (EDT).
const MORNING = new Date("2026-10-19T13:00:00Z");
const NONE: History = { recent: [], seenKeys: [] };
const SYNC: BrainSettings = { trigger: "sync" };

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
  };
}

const keys = (messages: { dedupeKey: string }[]) => messages.map((m) => m.dedupeKey);
const ids = (m: { actions: { id: string }[] }) => m.actions.map((a) => a.id);
const bySource = (s: Snapshot, source: string) =>
  gather(s, MORNING, SYNC).filter((m) => m.source === source);
// Everything planned except the brief.
const posted = (s: Snapshot, history = NONE, now = MORNING) =>
  plan(s, history, now, SYNC).filter((m) => m.kind !== "brief");

describe("the autopilot question", () => {
  it("asks once, with the three choices, until the person picks one", () => {
    const [message] = bySource(snapshot({ autopilot: null }), "autopilot");
    expect(message).toMatchObject({
      kind: "decision",
      dedupeKey: "autopilot:ask",
      priority: MESSAGE_PRIORITY.autopilot,
    });
    expect(message.body.split("\n")[0]).toBe("How much should I do on my own?");
    expect(message.body).toContain(AUTOPILOT_LEVELS.safe.description);
    expect(message.actions).toEqual([
      { id: "autopilot.safe", label: "Handle the safe stuff", kind: "primary" },
      { id: "autopilot.all", label: "Handle everything allowed", kind: "secondary" },
      { id: "autopilot.ask", label: "Ask me first", kind: "secondary" },
      { id: "open", label: "Settings", kind: "link", href: "/settings#autopilot" },
    ]);
  });

  it("stays quiet once a level is picked, custom included", () => {
    for (const autopilot of ["safe", "all", "ask", "custom"]) {
      expect(bySource(snapshot({ autopilot }), "autopilot")).toEqual([]);
    }
  });

  it("is never asked twice", () => {
    expect(
      posted(snapshot({ autopilot: null }), { recent: [], seenKeys: ["autopilot:ask"] }),
    ).toEqual([]);
  });

  it("is outside the daily limit, so it never pushes anything else out", () => {
    const busy = snapshot({
      autopilot: null,
      urgentAlerts: Array.from({ length: 2 }, (_, i) => ({ id: `al${i}`, title: "A", body: "a" })),
      findings: Array.from({ length: 5 }, (_, i) => ({
        findingId: `f${i}`,
        type: "price_increase" as const,
        title: "Netflix went up",
        annualSavingsCents: 1_000,
        savings: "Could save about $10.00 a year",
        fingerprint: "fp",
        urgent: false,
        pick: null,
      })),
    });
    const out = posted(busy);
    expect(keys(out)).toContain("autopilot:ask");
    expect(out).toHaveLength(CHAT_DAILY_LIMIT + 1);
    // Posted earlier today, it doesn't count against what's left.
    const recent = [{ kind: "decision", dedupeKey: "autopilot:ask", createdAt: MORNING }];
    expect(posted({ ...busy, autopilot: "safe" }, { recent, seenKeys: [] })).toHaveLength(
      CHAT_DAILY_LIMIT,
    );
  });
});

describe("set-up suggestions", () => {
  const budget = {
    kind: "budget" as const,
    key: "budget:Food and drink",
    category: "Food and drink",
    amountCents: 42_000,
  };
  const yearly = {
    kind: "goal" as const,
    key: "goal:yearly_bills",
    name: "Yearly bills",
    targetCents: 120_000,
    targetDate: "2027-10-19",
    monthlySpendingCents: 300_000,
    monthlySetAsideCents: 10_000,
  };
  const emergency = {
    kind: "goal" as const,
    key: "goal:emergency_fund",
    name: "Emergency fund",
    targetCents: 900_000,
    targetDate: "2027-10-19",
    monthlySpendingCents: 300_000,
  };

  it("offers each one with Set it up and No, said as math from the person's own numbers", () => {
    const [message] = bySource(snapshot({ setupProposals: [budget] }), "setup");
    expect(message).toMatchObject({
      kind: "decision",
      dedupeKey: "setup:budget:Food and drink:42000",
      refs: { proposalKey: "budget:Food and drink" },
      priority: MESSAGE_PRIORITY.setup,
      body: "I could set a $420.00 monthly budget for Food and drink. That's your own average over the last 3 complete months, rounded up: math from your data, not advice. Want me to set it up?",
    });
    expect(message.actions).toEqual([
      { id: "setup.yes", label: "Set it up", kind: "primary" },
      { id: "setup.no", label: "No", kind: "secondary" },
      { id: "open", label: "See the plan", kind: "link", href: "/plan" },
    ]);
  });

  it("includes the Yearly bills goal, and offers Use all N when there's more than one", () => {
    const messages = bySource(snapshot({ setupProposals: [budget, yearly, emergency] }), "setup");
    expect(messages.map((m) => m.body)).toEqual([
      expect.stringContaining("Food and drink"),
      'I could start a "Yearly bills" goal: $1,200.00 by October 2027. Your yearly and irregular bills come to $100.00 a month, so that\'s a year of it: math from your data, not advice. Want me to set it up?',
      'I could start an "Emergency fund" goal: $9,000.00 by October 2027. That\'s 3 months of your own average spending ($3,000.00 a month): math from your data, not advice. Want me to set it up?',
    ]);
    for (const m of messages) {
      expect(ids(m)).toEqual(["setup.yes", "setup.all", "setup.no", "open"]);
      expect(m.actions[1].label).toBe("Use all 3 suggestions");
    }
  });

  it("stays quiet with nothing to suggest, and keeps to its daily limit", () => {
    expect(bySource(snapshot(), "setup")).toEqual([]);
    const out = posted(snapshot({ setupProposals: [budget, yearly, emergency] }));
    expect(out.filter((m) => m.source === "setup")).toHaveLength(CHAT_SOURCE_LIMITS.setup);
  });

  it("never offers the same suggestion twice; a new amount is a new suggestion", () => {
    const seen = { recent: [], seenKeys: ["setup:budget:Food and drink:42000"] };
    expect(posted(snapshot({ setupProposals: [budget] }), seen)).toEqual([]);
    expect(
      keys(posted(snapshot({ setupProposals: [{ ...budget, amountCents: 45_000 }] }), seen)),
    ).toEqual(["setup:budget:Food and drink:45000"]);
  });
});

describe("things waiting on the person", () => {
  const step = (over: Partial<SnapshotAgentStep>): SnapshotAgentStep => ({
    actionId: "a1",
    step: "question",
    title: "Gym refund",
    company: "FitClub",
    todo: null,
    url: null,
    switchName: null,
    ...over,
  });

  it("shows a company's question, with Answer linking to the action", () => {
    const [message] = bySource(
      snapshot({
        agentSteps: [
          step({
            todo: "FitClub asked: What's your member number? Answer on your actions page and Jane will reply.",
          }),
        ],
      }),
      "steps",
    );
    expect(message.body).toBe(
      `I need your answer on "Gym refund". FitClub asked: What's your member number? Tap Answer and I'll send it on.`,
    );
    expect(message.refs).toEqual({ actionId: "a1", step: "question" });
    expect(message.actions).toEqual([
      { id: "open", label: "Answer", kind: "link", href: "/actions#action-a1" },
      { id: "snooze", label: "Not now", kind: "secondary" },
    ]);
    expect(message.priority).toBe(MESSAGE_PRIORITY.agent_step);
  });

  it("asks again when the company asks something new", () => {
    const first = bySource(snapshot({ agentSteps: [step({ todo: "Q1" })] }), "steps")[0];
    const second = bySource(snapshot({ agentSteps: [step({ todo: "Q2" })] }), "steps")[0];
    expect(first.dedupeKey).not.toBe(second.dedupeKey);
    expect(
      posted(snapshot({ agentSteps: [step({ todo: "Q1" })] }), {
        recent: [],
        seenKeys: [first.dedupeKey],
      }),
    ).toEqual([]);
  });

  it("offers Accept and Decline on an offer made on a call", () => {
    const [message] = bySource(
      snapshot({
        agentSteps: [
          step({
            step: "offer",
            title: "Lower your Comcast bill",
            todo: "Comcast offered $95.00 a month with a 12-month contract. Nothing was accepted: say yes or no on your actions page.",
          }),
        ],
      }),
      "steps",
    );
    expect(message.body).toBe(
      'On the call about "Lower your Comcast bill": Comcast offered $95.00 a month with a 12-month contract. Nothing was accepted. Do you want it?',
    );
    expect(ids(message)).toEqual(["offer.accept", "offer.decline", "open"]);
    expect(message.dedupeKey).toBe("steps:offer:a1");
  });

  it("gives the cancel page and I've cancelled for a company that only cancels online", () => {
    const [message] = bySource(
      snapshot({
        agentSteps: [
          step({ step: "self_cancel", company: "Streamwise", url: "https://s.example/cancel" }),
        ],
      }),
      "steps",
    );
    expect(message.actions).toEqual([
      { id: "cancel.done", label: "I've cancelled", kind: "primary" },
      { id: "open", label: "Open cancel page", kind: "link", href: "https://s.example/cancel" },
      { id: "snooze", label: "Not now", kind: "secondary" },
    ]);
    expect(message.body).toMatch(/^Streamwise only cancels from your own account/);
  });

  it("gives the sign-up link for a switch, or the action when there's no safe link", () => {
    const [withLink] = bySource(
      snapshot({
        agentSteps: [
          step({
            step: "switch",
            switchName: "Basic",
            url: "https://s.example/signup",
            todo: "Change your plan.",
          }),
        ],
      }),
      "steps",
    );
    expect(withLink.body).toBe("Your switch to Basic is ready for you. Change your plan.");
    expect(withLink.actions[0]).toEqual({
      id: "open",
      label: "Sign up",
      kind: "link",
      href: "https://s.example/signup",
    });
    const [without] = bySource(snapshot({ agentSteps: [step({ step: "switch" })] }), "steps");
    expect(without.actions[0]).toMatchObject({ href: "/actions#action-a1" });
  });

  it("isn't said twice: the generic waiting heads-up leaves those steps out", () => {
    const s = snapshot({
      waitingOnYou: [
        { id: "a1", title: "Gym refund", todo: "x" },
        { id: "a2", title: "Other", todo: "y" },
      ],
      agentSteps: [step({})],
    });
    expect(keys(bySource(s, "heads_ups"))).toEqual(["heads_ups:waiting:a2"]);
  });

  it("stays quiet with nothing waiting", () => {
    expect(bySource(snapshot(), "steps")).toEqual([]);
  });
});

describe("which step an action waits on", () => {
  const action = (over: Partial<Parameters<typeof stepOf>[0]>) => ({
    status: "waiting_on_user",
    agentState: "waiting_reply",
    type: "cancel_subscription",
    selfServiceUrl: null,
    ...over,
  });

  it("matches what the actions page shows a form or link for", () => {
    expect(stepOf(action({}))).toBe("question");
    expect(stepOf(action({ agentState: "confirming", type: "negotiate_bill" }))).toBe("offer");
    expect(stepOf(action({ agentState: "confirming", selfServiceUrl: "https://x" }))).toBe(
      "self_cancel",
    );
    expect(stepOf(action({ agentState: "switching", selfServiceUrl: "https://x" }))).toBe("switch");
  });

  it("is none otherwise", () => {
    expect(stepOf(action({ status: "in_progress" }))).toBeNull();
    expect(stepOf(action({ agentState: "handed_off" }))).toBeNull();
    expect(stepOf(action({ agentState: "confirming" }))).toBeNull();
    expect(stepOf(action({ agentState: "switching" }))).toBeNull();
  });
});

describe("budgets", () => {
  const progress = (spentCents: number, budgetCents = 50_000) => ({
    category: "Food and drink",
    budgetCents,
    spentCents,
    month: "2026-10",
  });

  it("says when a budget is nearly used up, with Open and Snooze", () => {
    const [message] = bySource(snapshot({ budgetProgress: [progress(46_000)] }), "budgets");
    expect(message).toMatchObject({
      kind: "heads_up",
      dedupeKey: "budgets:near:Food and drink:2026-10",
      body: "You've used 92% of your Food and drink budget this month: $460.00 of $500.00, with $40.00 left.",
      priority: MESSAGE_PRIORITY.budget_nearly_over,
    });
    expect(message.actions).toEqual([
      { id: "open", label: "Open", kind: "link", href: "/budgets" },
      { id: "snooze", label: "Snooze", kind: "secondary" },
    ]);
  });

  it("stays quiet below the threshold, once over (a heads-up says that) and with no budget", () => {
    expect(bySource(snapshot({ budgetProgress: [progress(44_000)] }), "budgets")).toEqual([]);
    expect(bySource(snapshot({ budgetProgress: [progress(50_001)] }), "budgets")).toEqual([]);
    expect(bySource(snapshot({ budgetProgress: [progress(0, 0)] }), "budgets")).toEqual([]);
  });

  it("is once a month per budget", () => {
    const s = snapshot({ budgetProgress: [progress(46_000)] });
    expect(posted(s, { recent: [], seenKeys: ["budgets:near:Food and drink:2026-10"] })).toEqual(
      [],
    );
    const next = snapshot({ budgetProgress: [{ ...progress(46_000), month: "2026-11" }] });
    expect(
      keys(posted(next, { recent: [], seenKeys: ["budgets:near:Food and drink:2026-10"] })),
    ).toEqual(["budgets:near:Food and drink:2026-11"]);
  });

  it("gives a budget gone over a Snooze too", () => {
    const [over] = bySource(
      snapshot({ budgetsOver: [{ category: "Food and drink", overCents: 100, month: "2026-10" }] }),
      "heads_ups",
    );
    expect(ids(over)).toEqual(["open", "snooze"]);
  });
});

describe("deadlines and alerts", () => {
  const deadline = (over: Partial<Snapshot["deadlines"][number]> = {}) => ({
    key: "entered:d1:2026-10-21",
    title: "FSA claim",
    date: "2026-10-21",
    kind: "fsa" as const,
    source: "entered" as const,
    amountCents: null,
    href: null,
    detail: null,
    entryId: "d1",
    ...over,
  });

  it("offers Mark done on one the person typed in, and Remind me tomorrow on all", () => {
    const [entered] = bySource(snapshot({ deadlines: [deadline()] }), "heads_ups");
    expect(entered.refs).toEqual({ deadlineKey: "entered:d1:2026-10-21", deadlineEntryId: "d1" });
    expect(entered.actions).toEqual([
      { id: "deadline.done", label: "Mark done", kind: "primary" },
      { id: "snooze", label: "Remind me tomorrow", kind: "secondary" },
      { id: "open", label: "Open", kind: "link", href: "/deadlines" },
    ]);
    const [renewal] = bySource(
      snapshot({
        deadlines: [deadline({ key: "renewal:x", source: "transactions", entryId: undefined })],
      }),
      "heads_ups",
    );
    expect(ids(renewal)).toEqual(["snooze", "open"]);
    expect(renewal.refs).toEqual({ deadlineKey: "renewal:x" });
  });

  it("offers Got it and Not now on an urgent alert", () => {
    const [alert] = bySource(
      snapshot({ urgentAlerts: [{ id: "al1", title: "Low balance", body: "Soon." }] }),
      "heads_ups",
    );
    expect(alert.actions).toEqual([
      { id: "alert.got_it", label: "Got it", kind: "primary" },
      { id: "snooze", label: "Not now", kind: "secondary" },
      { id: "open", label: "See alerts", kind: "link", href: "/alerts" },
    ]);
  });
});

describe("things you own", () => {
  it("asks for a home's value when a mortgage has nothing linked, opening the form prefilled", () => {
    const [message] = bySource(
      snapshot({
        assetPrompts: [
          {
            loanId: "l1",
            loanName: "Home Mortgage",
            kind: "home",
            href: "/things?kind=home&loan=l1",
          },
        ],
      }),
      "things",
    );
    expect(message).toMatchObject({
      kind: "heads_up",
      dedupeKey: "things:asset:l1",
      priority: MESSAGE_PRIORITY.asset_prompt,
    });
    expect(message.body).toMatch(/^Your Home Mortgage has no home linked to it\./);
    expect(message.actions).toEqual([
      {
        id: "open",
        label: "Add your home's value",
        kind: "link",
        href: "/things?kind=home&loan=l1",
      },
      { id: "snooze", label: "Not now", kind: "secondary" },
    ]);
  });

  it("says car for a car loan, and stays quiet with nothing to link", () => {
    const [car] = bySource(
      snapshot({
        assetPrompts: [{ loanId: "l2", loanName: "Auto Loan", kind: "vehicle", href: "/x" }],
      }),
      "things",
    );
    expect(car.actions[0].label).toBe("Add your car's value");
    expect(bySource(snapshot(), "things")).toEqual([]);
  });
});

describe("Not now (snooze)", () => {
  const s = snapshot({ urgentAlerts: [{ id: "al1", title: "Low balance", body: "Soon." }] });
  const key = "heads_ups:alert:al1";
  const tomorrow = startOfTomorrow(MORNING, "America/New_York");
  const snoozed: History = {
    recent: [{ kind: "heads_up", dedupeKey: key, createdAt: MORNING }],
    seenKeys: [key],
    snoozed: [{ dedupeKey: key, until: tomorrow }],
  };

  it("isn't posted again before the snooze is over", () => {
    expect(posted(s, snoozed, new Date(MORNING.getTime() + 60 * 60 * 1000))).toEqual([]);
    expect(posted(s, snoozed, new Date(tomorrow.getTime() - 1))).toEqual([]);
  });

  it("comes back once it's over, if it still applies", () => {
    // 9am the next day.
    const next = new Date(MORNING.getTime() + 24 * 60 * 60 * 1000);
    expect(keys(posted(s, snoozed, next))).toEqual([key]);
    expect(posted(snapshot(), snoozed, next)).toEqual([]);
  });

  it("ends at the start of the person's tomorrow, in their timezone", () => {
    expect(startOfTomorrow(MORNING, "America/New_York").toISOString()).toBe(
      "2026-10-20T04:00:00.000Z",
    );
    expect(startOfTomorrow(MORNING, "America/Los_Angeles").toISOString()).toBe(
      "2026-10-20T07:00:00.000Z",
    );
    expect(startOfTomorrow(MORNING, "Asia/Kolkata").toISOString()).toBe("2026-10-19T18:30:00.000Z");
    // US Pacific when unset, and across the clocks going back (Nov 1, 2026).
    expect(startOfTomorrow(new Date("2026-10-31T20:00:00Z"), null).toISOString()).toBe(
      "2026-11-01T07:00:00.000Z",
    );
    expect(startOfTomorrow(new Date("2026-11-01T20:00:00Z"), null).toISOString()).toBe(
      "2026-11-02T08:00:00.000Z",
    );
  });
});
