import { describe, expect, it } from "vitest";
import type { ComingUpRow } from "@/insights/coming-up";
import type { InsightTransaction } from "@/insights/spending";
import { recommendsAChoice } from "@/lib/guardrails";
import type { JaneDid } from "@/lib/what-jane-did";
import type { AffordNumbers } from "@/planning/afford";
import { parseIntent, type Intent } from "./intents";
import {
  actReply,
  affordReply,
  approveAllReply,
  comingUpReply,
  helpReply,
  matchFinding,
  pauseReply,
  safeReply,
  spendingReply,
  undoReply,
  unknownReply,
  whatDidReply,
} from "./replies";
import type { Snapshot, SnapshotFinding } from "./snapshot";

// Spec step 84: each intent's answer from fixtures. Fixed wording, the person's own numbers,
// and only buttons from the registry; nothing is done until a tap.

const NOW = new Date("2026-10-18T15:00:00Z");
const TODAY = "2026-10-18";

function intent<K extends Intent["kind"]>(text: string, kind: K): Extract<Intent, { kind: K }> {
  const parsed = parseIntent(text, TODAY);
  if (parsed.kind !== kind) throw new Error(`"${text}" parsed as ${parsed.kind}`);
  return parsed as Extract<Intent, { kind: K }>;
}

const buttonIds = (r: { actions: { id: string }[] }) => r.actions.map((a) => a.id);

describe("affordReply", () => {
  const numbers: AffordNumbers = {
    asOf: TODAY,
    safe: { payday: "2026-10-30", balanceCents: 300_000, safeCents: 120_000 },
    flows: [
      { date: "2026-10-30", amountCents: 250_000 },
      { date: "2026-11-01", amountCents: -180_000 },
    ],
    goals: [
      {
        id: "g1",
        name: "Emergency fund",
        targetCents: 600_000,
        targetDate: "2027-10-18",
        savedCents: 0,
      },
    ],
  };

  it("shows the effect on safe to spend and goals now, with no goal button", () => {
    const reply = affordReply(intent("can I afford $200 for a jacket", "afford"), numbers);
    expect(reply.body).toContain("If you spend $200.00 on a jacket now:");
    expect(reply.body).toContain("Safe to spend until Oct 30: $1,200.00 → $1,000.00");
    expect(reply.body).toContain(
      "Emergency fund: $500.00 a month → $516.67 a month to reach it by Oct 18, 2027.",
    );
    expect(reply.body).toContain("This is math, not a recommendation.");
    expect(buttonIds(reply)).toEqual(["open"]);
    expect(reply.actions[0]).toMatchObject({
      href: "/afford?kind=purchase&amount=200.00&date=2026-10-18",
    });
    expect(recommendsAChoice(reply.body)).toBe(false);
  });

  it("offers to start a goal for a purchase in a later month", () => {
    const reply = affordReply(intent("can I afford $900 for a trip in March", "afford"), numbers);
    expect(reply.body).toContain("If you spend $900.00 on a trip in March 2027:");
    // After payday, so safe to spend doesn't change.
    expect(reply.body).toContain("Safe to spend stays $1,200.00 until Oct 30");
    expect(buttonIds(reply)).toEqual(["goal.start", "open"]);
    expect(reply.refs.goal).toEqual({
      name: "Trip",
      targetCents: 90_000,
      targetDate: "2027-03-01",
    });
  });

  it("asks for an amount, and keeps to the next 12 months", () => {
    expect(affordReply(intent("can I afford a trip", "afford"), numbers).body).toMatch(
      /^How much is it\?/,
    );
    expect(affordReply(intent("can I afford $900 in march 2029", "afford"), numbers).body).toBe(
      "Pick a month in the next 12 months.",
    );
  });

  it("says when there's no checking account", () => {
    const reply = affordReply(intent("can I afford 50", "afford"), { ...numbers, safe: null });
    expect(reply.body).toContain("Link a checking account");
  });
});

describe("spendingReply", () => {
  const t = (date: string, cents: number, pfcPrimary: string, merchant: string) =>
    ({
      date,
      amountCents: cents,
      description: merchant,
      merchantName: merchant,
      pfcPrimary,
      pfcDetailed: null,
      pending: false,
    }) satisfies InsightTransaction;
  const transactions = [
    t("2026-10-02", 4_500, "FOOD_AND_DRINK", "Chipotle"),
    t("2026-10-10", 12_000, "FOOD_AND_DRINK", "Whole Foods"),
    t("2026-10-11", 8_999, "GENERAL_MERCHANDISE", "Target"),
    t("2026-10-12", 8_999, "GENERAL_MERCHANDISE", "Target"),
    t("2026-09-05", 30_000, "FOOD_AND_DRINK", "Whole Foods"),
    t("2026-09-06", 150_000, "RENT_AND_UTILITIES", "Landlord"),
  ];

  it("answers for a category in loose words, this month and last", () => {
    expect(
      spendingReply(intent("how much did I spend on food", "spending"), transactions, TODAY).body,
    ).toBe("You spent $165.00 on Food and drink in October 2026 so far.");
    expect(
      spendingReply(
        intent("how much did I spend on groceries last month", "spending"),
        transactions,
        TODAY,
      ).body,
    ).toBe("You spent $300.00 on Food and drink in September 2026.");
  });

  it("totals the month with its biggest categories when none is named", () => {
    expect(
      spendingReply(intent("how much did I spend last month", "spending"), transactions, TODAY)
        .body,
    ).toBe(
      "You spent $1,800.00 in September 2026. The most went to: Rent and utilities $1,500.00, Food and drink $300.00.",
    );
  });

  it("tries a merchant when the word isn't a category", () => {
    const reply = spendingReply(
      intent("how much did i spend at target", "spending"),
      transactions,
      TODAY,
    );
    expect(reply.body).toBe("You spent $179.98 at Target in October 2026 so far.");
    expect(reply.actions).toEqual([
      { id: "open", label: "See insights", kind: "link", href: "/insights" },
    ]);
  });

  it("says when it can't find it, or the month is too far back", () => {
    expect(
      spendingReply(intent("how much did I spend on llamas", "spending"), transactions, TODAY).body,
    ).toMatch(/^I couldn't find spending on "llamas" in October 2026 so far\./);
    expect(
      spendingReply({ kind: "spending", category: null, month: "2024-01" }, transactions, TODAY)
        .body,
    ).toBe("I can only see the last 12 months of spending.");
  });
});

describe("comingUpReply", () => {
  const rows: ComingUpRow[] = [
    {
      key: "b1",
      date: "2026-10-20",
      label: "Netflix",
      amountCents: 1_549,
      daysLeft: 2,
      href: "/bills",
    },
    {
      key: "d1",
      date: "2026-10-18",
      label: "FSA deadline",
      amountCents: null,
      daysLeft: 0,
      href: "/deadlines",
    },
    {
      key: "b2",
      date: "2026-11-01",
      label: "Rent",
      amountCents: 200_000,
      daysLeft: 14,
      href: "/bills",
    },
  ];

  it("lists what's coming, soonest as given", () => {
    expect(comingUpReply(intent("what's due", "coming_up"), rows).body).toBe(
      "Here's what's coming up:\n- Oct 20 (in 2 days): Netflix, $15.49\n- Oct 18 (today): FSA deadline\n- Nov 1 (in 14 days): Rent, $2,000.00",
    );
  });

  it("keeps to the week when asked", () => {
    const reply = comingUpReply(intent("what's due this week", "coming_up"), rows);
    expect(reply.body).not.toContain("Rent");
    expect(comingUpReply(intent("what's due this week", "coming_up"), []).body).toBe(
      "Nothing due this week that I can see.",
    );
  });
});

describe("safeReply", () => {
  it("gives the number until payday", () => {
    expect(safeReply({ safeCents: 123_456, payday: "2026-10-30" }).body).toMatch(
      /^You have \$1,234\.56 safe to spend until Oct 30, your next payday\./,
    );
  });

  it("asks for a checking account without one", () => {
    expect(safeReply(null).actions).toEqual([
      { id: "open", label: "Link a bank", kind: "link", href: "/connect" },
    ]);
  });
});

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
    timezone: "America/Los_Angeles",
    asOf: TODAY,
    weekStart: "2026-10-12",
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
    // Spec step 83's fields.
    budgetProgress: [],
    autopilot: "safe",
    setupProposals: [],
    agentSteps: [],
    assetPrompts: [],
    ...over,
  };
}

describe("actReply", () => {
  const findings = [
    finding(),
    finding({
      findingId: "f2",
      type: "bill_negotiation",
      title: "Your Verizon phone bill is above the typical price",
      fingerprint: "fp2",
      pick: { optionId: "mint", name: "Mint Mobile", savingCents: 30_000, savings: false },
    }),
    finding({
      findingId: "f3",
      type: "duplicate_charge",
      title: "Charged twice? $89.99 at Target",
      fingerprint: "fp3",
    }),
  ];

  it("answers 'cancel Hulu' with the finding as a decision, Yes and No, and does nothing", () => {
    const reply = actReply(intent("cancel Hulu", "act"), snapshot({ findings }), NOW);
    expect(reply.body).toBe(
      "Review your Hulu subscription. Could save about $215.88 a year. Want me to handle it?",
    );
    expect(buttonIds(reply)).toEqual(["finding.yes", "finding.no", "open"]);
    expect(reply.refs).toEqual({ findingId: "f1", fingerprint: "fp1" });
  });

  it("finds a bill by its kind, with Jane's pick", () => {
    const reply = actReply(intent("lower my phone bill", "act"), snapshot({ findings }), NOW);
    expect(reply.refs).toMatchObject({ findingId: "f2", pickOptionId: "mint" });
    expect(buttonIds(reply)).toEqual(["finding.yes", "finding.pick", "finding.no", "open"]);
  });

  it("finds a refund", () => {
    const reply = actReply(intent("get my refund from Target", "act"), snapshot({ findings }), NOW);
    expect(reply.refs.findingId).toBe("f3");
  });

  it("says so and offers subscriptions when nothing matches", () => {
    const reply = actReply(intent("cancel Spotify", "act"), snapshot({ findings }), NOW);
    expect(reply.body).toBe(
      `I don't see anything open about "spotify" right now, so there's nothing for me to cancel yet.`,
    );
    expect(reply.actions).toEqual([
      { id: "open", label: "Open subscriptions", kind: "link", href: "/subscriptions" },
    ]);
    expect(actReply(intent("cancel my subscription", "act"), snapshot(), NOW).body).toMatch(
      /^Which one\?/,
    );
    expect(buttonIds(actReply(intent("cancel Hulu", "act"), null, NOW))).toEqual(["open"]);
  });
});

describe("matchFinding", () => {
  it("prefers the kinds that fit the command, then the biggest saving", () => {
    const hulu = [
      finding({
        findingId: "a",
        type: "price_increase",
        title: "Hulu went up",
        annualSavingsCents: 9_000,
      }),
      finding({ findingId: "b", annualSavingsCents: 1_000 }),
    ];
    expect(matchFinding(hulu, "cancel", "hulu")?.findingId).toBe("b");
    expect(matchFinding(hulu, "lower", "hulu")?.findingId).toBe("a");
    expect(matchFinding(hulu, "cancel", "")).toBeNull();
  });
});

describe("whatDidReply", () => {
  const nothing: JaneDid = {
    finished: [],
    confirmedCents: 0,
    contacts: 0,
    working: 0,
    waiting: [],
  };

  it("sums up the week", () => {
    const reply = whatDidReply({
      finished: [
        {
          actionId: "a1",
          title: "Refund the double charge",
          confirmedCents: 8_999,
          completedAt: NOW,
        },
      ],
      confirmedCents: 8_999,
      contacts: 3,
      working: 2,
      waiting: [{ title: "Cancel Hulu", todo: "Confirm the cancellation email." }],
    });
    expect(reply.body).toBe(
      [
        `This week I finished 1 thing, with $89.99 confirmed back or saved: "Refund the double charge".`,
        "I'm working on 2 things.",
        "I wrote or called companies 3 times.",
        `1 thing waits on you. First: "Cancel Hulu": Confirm the cancellation email.`,
      ].join("\n"),
    );
    expect(reply.actions[0]).toMatchObject({ href: "/actions" });
  });

  it("says when there's nothing yet", () => {
    expect(whatDidReply(nothing).body).toMatch(/^Nothing new this week\./);
  });
});

describe("approveAllReply", () => {
  it("offers 'Approve all safe ones' but never approves by itself", () => {
    const reply = approveAllReply(
      snapshot({ plan: { items: 4, annualSavingsCents: 10_000, safeItems: 2 } }),
    );
    expect(reply.body).toMatch(/^2 things on your plan are safe to approve together/);
    expect(buttonIds(reply)).toEqual(["plan.approve_safe", "open"]);
  });

  it("says when nothing is safe to approve together", () => {
    expect(buttonIds(approveAllReply(snapshot()))).toEqual(["open"]);
  });
});

describe("undoReply", () => {
  const approval = (over = {}) => ({
    decisionId: "d1",
    title: "Refund the double charge",
    ruleLabel: "Refund double charges",
    createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    canUndo: true,
    ...over,
  });

  it("offers Undo on the newest yes a rule gave that can still be taken back", () => {
    const reply = undoReply(
      snapshot({
        ruleApprovals: [
          approval({ decisionId: "old", createdAt: new Date(NOW.getTime() - 5 * 3_600_000) }),
          approval(),
        ],
      }),
      NOW,
    );
    expect(reply.body).toBe(
      `Undo my yes to "Refund the double charge"? It goes back on your plan.`,
    );
    expect(buttonIds(reply)).toEqual(["undo.rule", "open"]);
    expect(reply.refs).toEqual({ decisionId: "d1", undoUntil: "2026-10-19T14:00:00.000Z" });
  });

  it("offers nothing once the work started", () => {
    const reply = undoReply(snapshot({ ruleApprovals: [approval({ canUndo: false })] }), NOW);
    expect(buttonIds(reply)).toEqual(["open"]);
  });
});

describe("pauseReply", () => {
  it("offers to pause, or says it's already off", () => {
    expect(buttonIds(pauseReply("safe"))).toEqual(["autopilot.pause", "open"]);
    expect(buttonIds(pauseReply("ask"))).toEqual(["open"]);
    expect(pauseReply(null).body).toMatch(/already off/);
  });
});

describe("help and unknown", () => {
  it("lists what you can ask, and that typing never acts alone", () => {
    expect(helpReply().body).toContain("- can I afford $900 for a trip in March");
    expect(helpReply().body).toContain("I never act on what you type alone");
    expect(unknownReply().body).toMatch(/^I can help with your money here/);
  });

  it("never recommends a choice", () => {
    for (const body of [helpReply().body, unknownReply().body, pauseReply("all").body]) {
      expect(recommendsAChoice(body)).toBe(false);
    }
  });
});
