import { describe, expect, it } from "vitest";
import { CHAT_SOURCE_LIMITS, MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { BnplPlan } from "@/insights/bnpl";
import { debtBook, type DebtAccountInput } from "@/insights/debts";
import type { Payoff, StoredPlan } from "@/lib/debt-plan";
import { payoffSummary } from "@/planning/payoff";
import { gather, plan, type BrainSettings } from "./brain";
import { debtsToolOutput } from "./debt-tools";
import type { Snapshot } from "./snapshot";

// Spec step 109: Jane brings up a buy now, pay later plan it found and a debt with no
// rate, once each, and Claude's debts tool records every figure it gives.

const MORNING = new Date("2026-10-19T13:00:00Z");
const SYNC: BrainSettings = { trigger: "sync" };

const STORE: DebtAccountInput = {
  id: "store",
  name: "Store Card",
  mask: null,
  type: "credit",
  subtype: "credit card",
  currentBalanceCents: 50_000,
  liability: null,
};
const CARD_WITH_TERMS: DebtAccountInput = {
  ...STORE,
  id: "card",
  name: "Demo Card",
  liability: {
    aprBps: 2299,
    rateType: null,
    minimumPaymentCents: 7_500,
    nextPaymentDueDate: null,
    payoffDate: null,
    isOverdue: null,
    pastDueCents: null,
    description: null,
  },
};
const KLARNA: BnplPlan = {
  key: "klarna:6225",
  provider: "klarna",
  providerName: "Klarna",
  kind: "pay_in_4",
  paymentCents: 6225,
  paymentsMade: 2,
  firstDate: "2026-10-02",
  lastDate: "2026-10-16",
  nextDate: "2026-10-30",
  paymentsLeft: 2,
  balanceCents: 12_450,
  payoffDate: "2026-11-13",
};

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
    debts: debtBook({ accounts: [STORE], plans: [KLARNA], typed: [] }, "2026-10-19"),
    ...over,
  };
}
const fromDebts = (s: Snapshot) => gather(s, MORNING, SYNC).filter((m) => m.source === "debts");

describe("Jane's debt messages", () => {
  it("says it found a plan, and asks for a missing rate with a link to the form", () => {
    const [found, rate] = fromDebts(snapshot());
    expect(found).toMatchObject({
      kind: "heads_up",
      dedupeKey: "debts:found:bnpl:klarna:6225",
      priority: MESSAGE_PRIORITY.debt_found,
      actions: [{ id: "open", label: "See every debt", kind: "link", href: "/loans" }],
    });
    expect(found.body).toContain("2 of 4 payments made, $124.50 left, the last payment on Nov 13");
    expect(rate).toMatchObject({
      dedupeKey: "debts:rate:account:store",
      priority: MESSAGE_PRIORITY.debt_missing_rate,
      body: "Your bank doesn't report a rate for your Store Card. Add it and I'll count it in your debts and in how you pay them off.",
    });
    expect(rate.actions).toEqual([
      {
        id: "open",
        label: "Add the rate",
        kind: "link",
        href: "/loans?terms=account%3Astore#terms",
      },
      { id: "snooze", label: "Not now", kind: "secondary" },
    ]);
  });

  it("stays quiet with nothing new, and never says the same thing twice", () => {
    expect(fromDebts(snapshot({ debts: undefined }))).toEqual([]);
    const seenKeys = ["debts:found:bnpl:klarna:6225", "debts:rate:account:store"];
    expect(
      plan(snapshot(), { recent: [], seenKeys }, MORNING, SYNC).filter((m) => m.source === "debts"),
    ).toEqual([]);
  });

  it("posts at most its daily limit", () => {
    const posted = plan(snapshot(), { recent: [], seenKeys: [] }, MORNING, SYNC).filter(
      (m) => m.source === "debts",
    );
    expect(posted).toHaveLength(CHAT_SOURCE_LIMITS.debts);
  });
});

describe("Claude's debts tool", () => {
  it("gives every debt with where its rate came from, recording each figure", () => {
    const cents: number[] = [];
    const money = (c: number) => {
      cents.push(c);
      return `$${(c / 100).toFixed(2)}`;
    };
    const output = debtsToolOutput(
      debtBook({ accounts: [STORE], plans: [KLARNA], typed: [] }, "2026-10-19"),
      money,
    );
    expect(output).toMatchObject({
      loansAndCardsOwed: "$500.00",
      buyNowPayLaterOwed: "$124.50",
      totalOwed: "$624.50",
      missingRates: ["Store Card"],
    });
    expect(output.debts.find((d) => d.name === "Klarna Pay in 4")).toMatchObject({
      rate: "0.00%",
      rateFrom: expect.stringMatching(/no interest/),
      paymentEvery: "two weeks",
      inNetWorth: false,
    });
    expect(cents).toEqual(expect.arrayContaining([50_000, 12_450, 62_450, 6225]));
  });
});

describe("Jane's payoff plan messages", () => {
  const book = debtBook({ accounts: [CARD_WITH_TERMS], plans: [KLARNA], typed: [] }, "2026-10-19");
  const payoff = (over: Partial<Payoff> = {}): Payoff => ({
    advice: true,
    book,
    summary: payoffSummary(book.debts, { extraCents: 0, advice: true }),
    debtFreeMonth: "2027-08",
    stored: null,
    ...over,
  });
  const STORED: StoredPlan = {
    strategy: "avalanche",
    extraCents: 0,
    startedOn: "2026-09-18",
    checkedOn: "2026-10-19",
    debtFreeMonth: "2027-09",
    previousDebtFreeMonth: "2027-08",
    status: "off_track",
    expectedCents: 200_000,
    actualCents: 230_000,
  };
  const fromPayoff = (p: Payoff | undefined) =>
    gather(snapshot({ payoff: p }), MORNING, SYNC).filter((m) => m.source === "payoff");

  it("offers a plan once there are debts and none is started, as labelled demo advice", () => {
    const [offer] = fromPayoff(payoff());
    expect(offer).toMatchObject({
      kind: "decision",
      dedupeKey: "payoff:offer",
      priority: MESSAGE_PRIORITY.payoff_offer,
      refs: { advice: true, debtPlanExtraCents: 0 },
    });
    expect(offer.body.split("\n")[0]).toBe("I worked out a plan to pay off your debts.");
    expect(offer.actions[0]).toEqual({
      id: "debt_plan.avalanche",
      label: "Start this plan",
      kind: "primary",
    });
  });

  it("offers the math with no pick outside demo advice mode", () => {
    const real = payoff({
      advice: false,
      summary: payoffSummary(book.debts, { extraCents: 0, advice: false }),
    });
    const [offer] = fromPayoff(real);
    expect(offer.refs.advice).toBeUndefined();
    expect(offer.body).toContain("This is math, not a recommendation.");
    expect(offer.actions.map((a) => a.label)).toEqual([
      "Track highest rate first",
      "Track smallest balance first",
      "Open the payoff planner",
    ]);
  });

  it("says when the plan is off track, with the new debt-free month", () => {
    const [message] = fromPayoff(payoff({ stored: STORED }));
    expect(message).toMatchObject({
      kind: "heads_up",
      dedupeKey: "payoff:check:2026-10-19",
      priority: MESSAGE_PRIORITY.payoff_off_track,
    });
    expect(message.body).toBe(
      "Your payoff plan is off track: your debts add up to $2,300.00, and the plan expected $2,000.00 by now, $300.00 behind. At this pace you'd be debt-free by September 2027 instead of August 2027. New charges on a card or a missed payment usually explain it.",
    );
  });

  it("says when it's on track, and nothing before the first check or without debts", () => {
    const [message] = fromPayoff(payoff({ stored: { ...STORED, status: "on_track" } }));
    expect(message).toMatchObject({ kind: "done", priority: MESSAGE_PRIORITY.payoff_on_track });
    expect(message.body).toMatch(
      /^I checked your payoff plan: you're on track, with \$2,300\.00 left/,
    );
    expect(fromPayoff(payoff({ stored: { ...STORED, status: null } }))).toEqual([]);
    expect(fromPayoff(undefined)).toEqual([]);
    const empty = debtBook({ accounts: [], plans: [], typed: [] }, "2026-10-19");
    expect(
      fromPayoff(
        payoff({
          book: empty,
          summary: payoffSummary(empty.debts, { extraCents: 0, advice: true }),
        }),
      ),
    ).toEqual([]);
  });
});
