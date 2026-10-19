import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";
import { rankedFor } from "./priorities";
import type { Snapshot, SnapshotFinding } from "./snapshot";
import { wholePicture, wholePictureReply } from "./whole-picture";

// Spec step 183: "am I OK?" and "what should I do this month?" answered whole, from every
// sector in Jane's snapshot, with the same figures each sector's own answer gives.

const ASOF = "2026-10-19";
const finding = (over: Partial<SnapshotFinding>): SnapshotFinding => ({
  findingId: "f1",
  type: "subscription_review",
  title: "Review your Hulu subscription",
  annualSavingsCents: 21_588,
  savings: "Could save about $215.88 a year",
  fingerprint: "fp-hulu",
  urgent: false,
  pick: null,
  confidence: "high",
  ...over,
});

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    timezone: "America/New_York",
    asOf: ASOF,
    weekStart: ASOF,
    safeToSpend: { safeCents: 123_456, payday: "2026-11-01" },
    comingUp: [
      {
        key: "bill:mortgage",
        date: "2026-11-01",
        label: "Rocket Mortgage",
        amountCents: 214_154,
        daysLeft: 13,
        href: "/bills",
      },
      {
        key: "bill:netflix",
        date: "2026-10-22",
        label: "Netflix",
        amountCents: 1_799,
        daysLeft: 3,
        href: "/bills",
      },
    ],
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

const answer = (s: Snapshot, focus: "now" | "month" = "now") =>
  wholePictureReply(s, rankedFor(s), focus);

describe("the whole-picture intent", () => {
  it.each([
    "am I ok?",
    "am i okay",
    "how am I doing",
    "how are my finances looking",
    "how's my money",
    "give me the big picture",
    "am I on track this month",
  ])("reads %j as how they're doing now", (text) => {
    const intent = parseIntent(text, ASOF);
    expect(intent.kind).toBe("whole_picture");
    expect(intent).toMatchObject({ focus: "now" });
  });

  it.each(["what should I do this month", "whats my plan for this month"])(
    "reads %j as this month's things",
    (text) => {
      expect(parseIntent(text, ASOF)).toEqual({ kind: "whole_picture", focus: "month" });
    },
  );

  it.each([
    "am I ok to spend $200 on shoes",
    "am I on track with my goals",
    "what should I do first",
  ])("leaves %j to its own answer", (text) => {
    expect(parseIntent(text, ASOF).kind).not.toBe("whole_picture");
  });
});

describe("the whole-picture answer", () => {
  it("answers first with safe to spend until payday, then what's due", () => {
    const reply = answer(snapshot());
    const [first, second] = reply.body.split("\n");
    expect(first).toBe(
      "Yes, you're OK: you have $1,234.56 safe to spend until payday, Nov 1 (in 13 days), and nothing is overdue.",
    );
    expect(second).toBe("Due in the next 7 days: Netflix $17.99 in 3 days.");
    expect(reply.actions.at(-1)).toMatchObject({ kind: "link", href: "/home" });
  });

  it("says when money is short or something is urgent, before anything else", () => {
    expect(
      answer(snapshot({ safeToSpend: { safeCents: -5_000, payday: "2026-11-01" } })).body,
    ).toMatch(/^Not quite: you're short by \$50\.00 until payday/);
    const urgent = answer(
      snapshot({ urgentAlerts: [{ id: "a1", title: "Your checking balance is low", body: "" }] }),
    );
    expect(urgent.body.split("\n")[0]).toBe(
      "Not quite: Your checking balance is low. Otherwise you have $1,234.56 safe to spend until payday, Nov 1 (in 13 days).",
    );
    expect(
      wholePicture(
        snapshot({ budgetsOver: [{ category: "Dining", overCents: 4_000, month: "2026-10" }] }),
        [],
        "now",
      ).headline,
    ).toBe(
      "Mostly: you have $1,234.56 safe to spend until payday, Nov 1 (in 13 days), but you're $40.00 over your Dining budget.",
    );
  });

  it("names the one to three things that matter, the first with its Yes", () => {
    const s = snapshot({
      findings: [
        finding({ findingId: "hulu" }),
        finding({
          findingId: "cash",
          type: "idle_cash",
          title: "Move idle cash",
          annualSavingsCents: 60_000,
          fingerprint: "fp-cash",
        }),
      ],
      plan: { items: 2, annualSavingsCents: 81_588, safeItems: 2 },
      working: 2,
      waitingOnYou: [{ id: "a1", title: "Cancel Hulu", todo: "Send the code" }],
    });
    const ranked = rankedFor(s);
    const reply = wholePictureReply(s, ranked, "now");
    const lines = reply.body.split("\n");
    expect(lines).toContain("I'm working on 2 things for you, and 1 thing needs a step from you.");
    expect(lines).toContain("These 2 matter most:");
    expect(lines.filter((l) => /^\d\. /.test(l))).toHaveLength(2);
    const first = ranked[0];
    expect(reply.actions[0]).toMatchObject({ id: "finding.yes", kind: "primary" });
    expect(reply.refs.findingId).toBe(first.ref);
    expect(reply.refs.fingerprint).toBe(first.ref === "hulu" ? "fp-hulu" : "fp-cash");
    expect(reply.actions.some((a) => a.id === "plan.approve_safe")).toBe(true);
  });

  it("leads with the things to do for this month, and what's due by the month's end", () => {
    const s = snapshot({ findings: [finding({ findingId: "hulu" })] });
    const lines = answer(s, "month").body.split("\n");
    expect(lines[0]).toBe(
      "This month, one thing matters most, starting with Review your Hulu subscription.",
    );
    expect(lines[1]).toMatch(/^1\. Review your Hulu subscription\./);
    expect(lines).toContain("Due before the month ends: Netflix $17.99 in 3 days.");
  });

  it("asks for a bank when there's nothing to look at", () => {
    expect(wholePictureReply(null, [], "now").actions[0]).toMatchObject({ href: "/connect" });
  });
});
