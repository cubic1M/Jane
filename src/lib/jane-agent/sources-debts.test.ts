import { describe, expect, it } from "vitest";
import { CHAT_SOURCE_LIMITS, MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { BnplPlan } from "@/insights/bnpl";
import { debtBook, type DebtAccountInput } from "@/insights/debts";
import { gather, plan, type BrainSettings } from "./brain";
import { debtsToolOutput } from "./debt-tools";
import type { Snapshot } from "./snapshot";

// Spec step 109: Jane brings up a buy now, pay later plan she found and a debt with no
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
  it("says she found a plan, and asks for a missing rate with a link to the form", () => {
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
