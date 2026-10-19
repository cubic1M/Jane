import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { GAP_ADVICE } from "@/config/insurance";
import { coverageGaps } from "@/lib/insurance/gaps";
import { resolveHousehold, type Household } from "@/lib/insurance/household";
import type { Policy } from "@/lib/insurance/policies";
import { gather, type BrainSettings } from "../brain";
import { parseIntent } from "../intents";
import type { Snapshot } from "../snapshot";
import { parseInsurance } from "./intents";
import { insuranceReply } from "./replies";
import type { InsuranceSnapshot } from "./snapshot";

// Insurance in Jane's chat (spec step 102): the questions, the answers from the policy
// records, and gaps as heads-ups.

const ASOF = "2026-10-19";
const MORNING = new Date("2026-10-19T13:00:00Z");
const SYNC: BrainSettings = { trigger: "sync" };

const policy = (over: Partial<Policy & { nextRenewal: string | null }> = {}) => ({
  id: "p1",
  kind: "auto" as const,
  carrier: "GEICO",
  status: "active" as const,
  source: "demo" as const,
  premiumCents: 14_200,
  premiumFrequency: "monthly" as const,
  deductibleCents: 100_000,
  coverage: { bodilyInjuryPerPerson: 5_000_000, collision: true, comprehensive: true },
  covers: "One car, two drivers.",
  renewalDate: "2026-11-28",
  termMonths: 12,
  documentId: null,
  merchantKey: "geico",
  nextRenewal: "2026-11-28",
  ...over,
});

const household = (
  over: Partial<Parameters<typeof resolveHousehold>[0] & object> = {},
): Household =>
  resolveHousehold(
    { housing: null, vehicles: null, dependants: null, pets: null, dismissedGaps: [], ...over },
    { mortgage: false, homeOwned: false, rentPaid: false, cars: 0 },
  );

function insurance(
  policies = [policy()],
  facts = household(),
  advice = false,
  canQuote = false,
): InsuranceSnapshot {
  return {
    policies,
    household: facts,
    gaps: coverageGaps(facts, policies),
    advice,
    canQuote,
    shopsItself: advice && canQuote,
    shops: [],
    noBetter: [],
  };
}

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    timezone: "America/New_York",
    asOf: ASOF,
    weekStart: ASOF,
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

describe("insurance questions", () => {
  it.each([
    ["What does my car insurance cover?", "cover", "auto"],
    ["when does my car insurance renew", "renew", "auto"],
    ["how much is my home insurance", "cost", "home"],
    ["what's my deductible", "deductible", null],
    ["what insurance do I have", "list", null],
    ["show my policies", "list", null],
    ["am I missing any insurance", "gaps", null],
    ["what insurance do I need", "gaps", null],
    ["am I covered if my car is stolen", "cover", "auto"],
    ["when does my renters policy expire", "renew", "renters"],
    ["what does my pet insurance pay back", "cover", "pet"],
  ])("reads %j as an insurance question", (text, ask, policyKind) => {
    expect(parseIntent(text, ASOF)).toEqual({ kind: "insurance", ask, policyKind });
  });

  it("leaves other questions alone", () => {
    expect(parseIntent("does my budget cover rent", ASOF).kind).not.toBe("insurance");
    expect(parseIntent("how much did I spend on insurance", ASOF).kind).toBe("spending");
    expect(parseIntent("cancel my car insurance", ASOF).kind).toBe("act");
    expect(parseInsurance("what's due this week")).toBeNull();
  });
});

describe("insurance answers", () => {
  const ask = (text: string) => parseInsurance(text.toLowerCase())!;

  it("says what a policy covers, from its record", () => {
    const reply = insuranceReply(ask("what does my car insurance cover"), insurance(), ASOF);
    expect(reply.body).toBe(
      [
        "Your GEICO car insurance:",
        "- One car, two drivers.",
        "- Injury liability, per person: $50,000.00",
        "- Collision (damage to your car in a crash): Yes",
        "- Comprehensive (theft, weather, fire to your car): Yes",
        "- Deductible: $1,000.00",
      ].join("\n"),
    );
    expect(reply.refs).toEqual({ policyId: "p1" });
    expect(reply.actions).toEqual([
      { id: "open", label: "See your insurance", kind: "link", href: "/insurance" },
    ]);
  });

  it("says when it renews and what it costs", () => {
    expect(insuranceReply(ask("when does my car insurance renew"), insurance(), ASOF).body).toBe(
      "Your GEICO car insurance renews on Nov 28, 2026, in 40 days.",
    );
    expect(insuranceReply(ask("how much is my car insurance"), insurance(), ASOF).body).toBe(
      "Your GEICO car insurance costs $142.00 a month ($1,704.00 a year).",
    );
    expect(insuranceReply(ask("what's my deductible"), insurance(), ASOF).body).toBe(
      "Your GEICO car insurance has a $1,000.00 deductible.",
    );
  });

  it("says when the record doesn't have it, and offers to add it", () => {
    const reply = insuranceReply(
      ask("when does my car insurance renew"),
      insurance([policy({ nextRenewal: null, renewalDate: null })]),
      ASOF,
    );
    expect(reply.body).toBe(
      "I don't have the renewal date for your GEICO car insurance.\nAdd it from your policy and I'll keep it on file.",
    );
    expect(reply.actions[0]).toEqual({
      id: "open",
      label: "Add the details",
      kind: "link",
      href: "/insurance?edit=p1#policy-p1",
    });
  });

  it("says there's no policy of that kind, with the gap when there is one", () => {
    const reply = insuranceReply(
      ask("what does my renters insurance cover"),
      insurance([policy()], household({ housing: "rent" })),
      ASOF,
    );
    expect(reply.body).toMatch(/^I don't have a renters insurance policy on file\. You told me/);
    expect(reply.actions[0]).toMatchObject({ href: "/insurance?add=renters#add" });
  });

  it("lists every policy, and points at gaps", () => {
    const reply = insuranceReply(
      ask("what insurance do I have"),
      insurance(
        [
          policy(),
          policy({
            id: "p2",
            kind: "life",
            carrier: "Haven",
            status: "found",
            premiumCents: null,
            nextRenewal: null,
          }),
        ],
        household({ dependants: 1, vehicles: 1 }),
      ),
      ASOF,
    );
    expect(reply.body).toBe(
      [
        "You have 2 policies on file:",
        "- GEICO car insurance: $142.00 a month ($1,704.00 a year), renews Nov 28, 2026, in 40 days",
        "- Haven life insurance (found from your payments, not confirmed yet)",
        'One thing looks missing from your cover: ask me "what am I missing?"',
      ].join("\n"),
    );
  });

  it("explains the gaps, or says nothing looks missing", () => {
    const gaps = insuranceReply(
      ask("am I missing any insurance"),
      insurance([], household({ housing: "rent" })),
      ASOF,
    );
    expect(gaps.body).toMatch(
      /^One thing looks missing from your cover:\n- No renters insurance on file\. You told me you rent/,
    );
    const advised = insuranceReply(
      ask("am I missing any insurance"),
      insurance([], household({ housing: "rent" }), true),
      ASOF,
    );
    expect(advised.body).toContain(GAP_ADVICE.renters.text);
    expect(advised.refs).toEqual({ advice: true });
    expect(gaps.refs).toEqual({});
    expect(insuranceReply(ask("am I missing any insurance"), insurance(), ASOF).body).toMatch(
      /^Nothing looks missing/,
    );
    expect(insuranceReply(ask("am I missing any insurance"), undefined, ASOF).body).toMatch(
      /^I don't have any of your policies yet/,
    );
  });
});

describe("coverage gaps as heads-ups", () => {
  const messages = (s: Snapshot) =>
    gather(s, MORNING, SYNC).filter((m) => m.source === "insurance");

  it("brings up each gap once, with I have it, I don't need it and Not now", () => {
    const [message] = messages(
      snapshot({ insurance: insurance([], household({ housing: "rent" })) }),
    );
    expect(message).toMatchObject({
      kind: "heads_up",
      dedupeKey: "insurance:gap:renters",
      priority: MESSAGE_PRIORITY.insurance_gap,
      refs: { insuranceGap: "renters" },
    });
    expect(message.body).toMatch(/^No renters insurance on file\. You told me you rent/);
    expect(message.actions).toEqual([
      {
        id: "open",
        label: "I have renters insurance",
        kind: "link",
        href: "/insurance?add=renters#add",
      },
      { id: "insurance.gap_no", label: "I don't need it", kind: "secondary" },
      { id: "snooze", label: "Not now", kind: "secondary" },
    ]);
  });

  it("says what to add only in demo advice mode, labelled (spec step 98)", () => {
    const facts = household({ housing: "rent" });
    const [plain] = messages(snapshot({ insurance: insurance([], facts) }));
    expect(plain.body).not.toContain(GAP_ADVICE.renters.text);
    expect(plain.refs.advice).toBeUndefined();
    const [advice] = messages(snapshot({ insurance: insurance([], facts, true) }));
    expect(advice.body.split("\n")[1]).toBe(GAP_ADVICE.renters.text);
    expect(advice.refs.advice).toBe(true);
  });

  it("links a liability-only car policy to its own record", () => {
    const only = policy({ coverage: { collision: false, comprehensive: false } });
    const [message] = messages(snapshot({ insurance: insurance([only]) }));
    expect(message.refs).toEqual({ insuranceGap: "liability_only", policyId: "p1" });
    expect(message.actions[0]).toMatchObject({ href: "/insurance?edit=p1#policy-p1" });
  });

  it("says nothing without gaps or without insurance in the snapshot", () => {
    expect(messages(snapshot({ insurance: insurance() }))).toEqual([]);
    expect(messages(snapshot())).toEqual([]);
  });
});
