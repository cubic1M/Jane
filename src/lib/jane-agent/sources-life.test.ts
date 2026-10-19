import { describe, expect, it } from "vitest";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { LifeGuess } from "@/insights/life-signals";
import { gather, plan, type BrainSettings } from "./brain";
import { checklistNote, lifeEventReply, lifeOffer } from "./replies-life";
import type { Snapshot } from "./snapshot";

// Spec step 100: the question about a life event Jane spotted, and her words for it.

const MORNING = new Date("2026-10-19T13:00:00Z");
const SYNC: BrainSettings = { trigger: "sync" };

const moving: LifeGuess = {
  kind: "moving",
  signals: [
    { key: "moving_company", text: "a U-Haul charge on Sep 28", date: "2026-09-28" },
    { key: "new_housing", text: "a first rent payment to Maple Court", date: "2026-10-01" },
    { key: "new_utility", text: "a new utility bill from Valley Electric", date: "2026-10-05" },
  ],
};

const snapshot = (lifeGuesses: LifeGuess[] | undefined): Snapshot =>
  ({
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
    lifeGuesses,
  }) as Snapshot;

describe("the life events source", () => {
  it("asks with every sign it saw, Yes, Not me and Don't ask again", () => {
    const [message] = gather(snapshot([moving]), MORNING, SYNC).filter((m) => m.source === "life");
    expect(message).toMatchObject({
      kind: "decision",
      body: "I noticed a U-Haul charge on Sep 28, a first rent payment to Maple Court and a new utility bill from Valley Electric. Are you moving? If so, I'll set a Home budget if you don't have one, flag your insurance to review and put reminders on your deadlines. Tap Yes and I'll start your moving checklist.",
      refs: { lifeKind: "moving" },
      dedupeKey: "life:moving",
      priority: MESSAGE_PRIORITY.life_event,
    });
    expect(message.actions.map((a) => a.label)).toEqual(["Yes", "Not me", "Don't ask again"]);
  });

  it("asks at most once a day, and never twice", () => {
    const job: LifeGuess = { kind: "new_job", signals: moving.signals.slice(0, 2) };
    const s = snapshot([moving, job]);
    const posted = plan(s, { recent: [], seenKeys: [] }, MORNING, SYNC).filter(
      (m) => m.source === "life",
    );
    expect(posted.map((m) => m.dedupeKey)).toEqual(["life:moving"]);
    const later = plan(s, { recent: [], seenKeys: ["life:moving"] }, MORNING, SYNC).filter(
      (m) => m.source === "life",
    );
    expect(later.map((m) => m.dedupeKey)).toEqual(["life:new_job"]);
  });

  it("says nothing without a guess", () => {
    expect(gather(snapshot(undefined), MORNING, SYNC).filter((m) => m.source === "life")).toEqual(
      [],
    );
  });
});

describe("Jane's words for life events", () => {
  it("offers what she'll do for each kind", () => {
    expect(lifeOffer("new_baby")).toBe(
      "I'll set Shopping and Personal care budgets if you don't have them, flag your insurance to review and put reminders on your deadlines.",
    );
  });

  it("says what she did", () => {
    expect(
      checklistNote("new_job", {
        eventId: "e1",
        budgets: [{ category: "Transportation", amountCents: 15_000 }],
        reminders: [{ title: "Sign up for benefits at your new job", dueOn: "2026-11-18" }],
      }),
    ).toBe(
      'Done. I started your new job checklist. I set a budget for Transportation at $150.00 a month. On your deadlines: "Sign up for benefits at your new job" by Nov 18.',
    );
    expect(checklistNote("moving", { eventId: "e1", budgets: [], reminders: [] })).toBe(
      "Done. I started your moving checklist.",
    );
  });

  it("answers 'I'm moving' with Start it, or the checklist already going", () => {
    expect(lifeEventReply("new_baby", false).body).toMatch(/^Congratulations! Want me to start/);
    const going = lifeEventReply("moving", true);
    expect(going.body).toBe(
      "You already have a moving checklist going. Open it to see what's left.",
    );
    expect(going.actions.map((a) => a.id)).toEqual(["open"]);
  });
});
