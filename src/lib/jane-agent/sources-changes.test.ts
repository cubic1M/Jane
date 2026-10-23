import { describe, expect, it } from "vitest";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { Change } from "@/insights/changes";
import type { ChangeView } from "@/lib/changes";
import { gather, plan, type BrainSettings } from "./brain";
import { changeLine, changesReply } from "./replies-changes";
import type { Snapshot, SnapshotFinding } from "./snapshot";

// Spec step 97: Jane's heads-ups about changes. Each kind gets its words and buttons; one
// she can act on asks with "Look into it" (and isn't asked again as a finding); one a
// standing rule already acted on isn't asked about; a few a day, what she can act on first.

const MORNING = new Date("2026-10-19T13:00:00Z");
const SYNC: BrainSettings = { trigger: "sync" };

const change = (over: Partial<ChangeView>): ChangeView => ({
  kind: "bill_changed",
  key: "bill:merchant:netflix:1799",
  date: "2026-10-14",
  title: "Netflix went up from $15.49 to $17.99.",
  amountCents: 1799,
  usualCents: 1549,
  merchant: "Netflix",
  category: null,
  usualMonthCents: null,
  streamKey: "merchant:netflix",
  up: true,
  accountId: null,
  finding: null,
  ...over,
});

const finding: SnapshotFinding = {
  findingId: "f1",
  type: "price_increase",
  title: "Netflix went up from $15.49 to $17.99",
  annualSavingsCents: 3000,
  savings: "Could save about $30.00 a year",
  fingerprint: "fp1",
  urgent: false,
  pick: null,
};

function snapshot(changes: ChangeView[], over: Partial<Snapshot> = {}): Snapshot {
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
    changes,
    ...over,
  };
}

const fromChanges = (s: Snapshot) => gather(s, MORNING, SYNC).filter((m) => m.source === "changes");
const ids = (m: { actions: { id: string }[] }) => m.actions.map((a) => a.id);
const open = { id: "f1", type: "price_increase", status: "new", handledBy: null } as const;

describe("the changes source", () => {
  it("asks about a price rise Jane can fight, and the finding isn't asked twice", () => {
    const s = snapshot([change({ finding: open })], { findings: [finding] });
    const [message] = fromChanges(s);
    expect(message).toMatchObject({
      kind: "decision",
      body: "Netflix went up from $15.49 to $17.99. Want me to ask them for your old price?",
      refs: {
        findingId: "f1",
        fingerprint: "fp1",
        change: { key: "bill:merchant:netflix:1799", kind: "bill_changed" },
      },
      dedupeKey: "changes:bill:merchant:netflix:1799",
      priority: MESSAGE_PRIORITY.change,
    });
    expect(ids(message)).toEqual(["change.look", "change.expected", "open"]);
    expect(gather(s, MORNING, SYNC).filter((m) => m.source === "findings")).toEqual([]);
    // Without the change, the finding asks for itself as before.
    expect(
      gather(snapshot([], { findings: [finding] }), MORNING, SYNC).filter(
        (m) => m.source === "findings",
      ),
    ).toHaveLength(1);
  });

  it("says a new subscription and its subscription card once (docs/feature-audit.md, cluster 10)", () => {
    const card: SnapshotFinding = {
      ...finding,
      findingId: "f2",
      type: "subscription_review",
      title: "Review your Peacock subscription",
      fingerprint: "fp2",
    };
    const s = snapshot(
      [
        change({
          kind: "new_subscription",
          key: "new:merchant:peacock",
          title: "Peacock is a new regular charge: $7.99, since Sep 20.",
          streamKey: "merchant:peacock",
          finding: { id: "f2", type: "subscription_review", status: "new", handledBy: null },
        }),
      ],
      { findings: [card] },
    );
    const [message] = fromChanges(s);
    expect(message).toMatchObject({
      kind: "decision",
      body: "Peacock is a new regular charge: $7.99, since Sep 20. Did you mean to sign up? If not, I can cancel it.",
      refs: { findingId: "f2", fingerprint: "fp2" },
    });
    expect(message.actions.map((a) => [a.id, a.label])).toEqual([
      ["change.look", "Cancel it"],
      ["change.expected", "That's expected"],
      ["open", "Open"],
    ]);
    // The card isn't asked again on its own.
    expect(gather(s, MORNING, SYNC).filter((m) => m.source === "findings")).toEqual([]);
  });

  it("leaves a late paycheck to the lean-plan question (docs/feature-audit.md, cluster 10)", () => {
    const late = change({
      kind: "paycheck_late",
      key: "late:acme:2026-10-15",
      title: "Your paycheck is late.",
    });
    expect(fromChanges(snapshot([{ ...late, askedByLean: true }]))).toEqual([]);
    // "What changed?" still lists it.
    expect(changesReply([{ ...late, askedByLean: true }]).body).toBe(
      "One thing changed lately.\n- Your paycheck is late.",
    );
  });

  it("stays quiet about one autopilot or the person already acted on", () => {
    for (const handledBy of ["rule", "person"] as const) {
      const s = snapshot([change({ finding: { ...open, handledBy } })], { findings: [finding] });
      expect(fromChanges(s)).toEqual([]);
    }
  });

  it.each<[Partial<Change>, string, string[]]>([
    [
      { up: false, title: "Netflix went down from $17.99 to $15.49." },
      "Good news: Netflix went down from $17.99 to $15.49.",
      ["change.expected", "open"],
    ],
    [
      { kind: "new_subscription", key: "new:merchant:peacock", title: "Peacock is new." },
      "Peacock is new. Did you mean to sign up?",
      ["change.expected", "open"],
    ],
    [
      { kind: "paycheck_late", key: "late:acme:2026-10-15", title: "Your paycheck is late." },
      "Your paycheck is late. If something changed at work, tell me and I'll keep your plan up to date.",
      ["change.expected", "open"],
    ],
    [
      { kind: "new_employer", key: "employer:globex", title: "A new employer." },
      "A new employer. New job? Congratulations.",
      ["change.expected", "open"],
    ],
    [
      { kind: "new_fee", key: "fee:tx1", title: "A late fee." },
      "A late fee. Fees can often be refunded.",
      ["change.expected", "open"],
    ],
  ])("words %j its own way", (over, body, buttons) => {
    const [message] = fromChanges(snapshot([change(over)]));
    expect(message.body).toBe(body);
    expect(ids(message)).toEqual(buttons);
  });

  it("offers a budget for a category over pace, unless there is one", () => {
    const pace = change({
      kind: "category_pace",
      key: "pace:Shopping:2026-10",
      title: "You've spent $400.00 on Shopping so far this month.",
      category: "Shopping",
      usualMonthCents: 9_550,
    });
    const [message] = fromChanges(snapshot([pace]));
    expect(message.body).toMatch(/Want a budget for it\?$/);
    expect(ids(message)).toEqual(["change.budget", "open", "change.expected"]);
    // Rounded up like the budget suggestions.
    expect(message.refs.change).toMatchObject({ category: "Shopping", budgetCents: 10_000 });

    const budgeted = snapshot([pace], {
      budgetProgress: [
        { category: "Shopping", budgetCents: 20_000, spentCents: 40_000, month: "2026-10" },
      ],
    });
    expect(ids(fromChanges(budgeted)[0])).toEqual(["open", "change.expected"]);
  });

  it("brings up what Jane can act on first, then paychecks, pace last, a couple a day", () => {
    const s = snapshot(
      [
        change({ kind: "category_pace", key: "pace:Shopping:2026-10", category: "Shopping" }),
        change({ kind: "paycheck_smaller", key: "smaller:acme:2026-10-15" }),
        change({ finding: open }),
      ],
      { findings: [finding] },
    );
    expect(fromChanges(s).map((m) => m.dedupeKey)).toEqual([
      "changes:bill:merchant:netflix:1799",
      "changes:smaller:acme:2026-10-15",
      "changes:pace:Shopping:2026-10",
    ]);
    const posted = plan(s, { recent: [], seenKeys: [] }, MORNING, SYNC).filter(
      (m) => m.source === "changes",
    );
    expect(posted.map((m) => m.dedupeKey)).toEqual([
      "changes:bill:merchant:netflix:1799",
      "changes:smaller:acme:2026-10-15",
    ]);
  });

  it("says nothing without changes", () => {
    expect(fromChanges(snapshot([]))).toEqual([]);
    expect(fromChanges({ ...snapshot([]), changes: undefined })).toEqual([]);
  });
});

describe("'what changed?'", () => {
  it("lists the changes, with what Jane already did", () => {
    const reply = changesReply([
      change({ finding: { ...open, handledBy: "rule" } }),
      change({ kind: "new_fee", key: "fee:tx1", title: "A late fee of $40.00." }),
    ]);
    expect(reply.body).toBe(
      "2 things changed lately.\n- Netflix went up from $15.49 to $17.99. I've already asked them for your old price. (autopilot)\n- A late fee of $40.00.",
    );
    expect(reply.actions).toEqual([
      { id: "open", label: "See insights", kind: "link", href: "/insights" },
    ]);
  });

  it("says so when nothing changed, and keeps the list short", () => {
    expect(changesReply([]).body).toMatch(/^Nothing's changed that I'd flag\./);
    const many = Array.from({ length: 7 }, (_, i) =>
      change({ key: `fee:${i}`, title: `Fee ${i}.` }),
    );
    expect(changesReply(many).body.split("\n").at(-1)).toBe("And 2 more.");
    expect(changeLine(change({ finding: { ...open, handledBy: "person" } }))).toBe(
      "Netflix went up from $15.49 to $17.99. I've already asked them for your old price.",
    );
  });
});
