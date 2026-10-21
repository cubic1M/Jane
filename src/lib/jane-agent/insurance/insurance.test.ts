import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { GAP_ADVICE } from "@/config/insurance";
import { coverageGaps } from "@/lib/insurance/gaps";
import { resolveHousehold, type Household } from "@/lib/insurance/household";
import type { Policy } from "@/lib/insurance/policies";
import type { Shop } from "@/lib/insurance/shop";
import { gather, type BrainSettings } from "../brain";
import { normalize, parseIntent } from "../intents";
import type { Snapshot } from "../snapshot";
import { parseInsurance } from "./intents";
import { autopilotReply } from "./autopilot";
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
        "Your GEICO car insurance covers what's below, from its record.",
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
        "You have 2 policies on file.",
        "- GEICO car insurance: $142.00 a month ($1,704.00 a year), renews Nov 28, 2026, in 40 days",
        "- Haven life insurance (found from your payments, not confirmed yet)",
        'One thing looks missing from your cover. Ask me "what am I missing?"',
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
      /^One thing looks missing from your cover\.\n- No renters insurance on file\. You told me you rent/,
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

describe("Jane's own reshops in the chat (spec step 104)", () => {
  const messages = (s: Snapshot) =>
    gather(s, MORNING, SYNC).filter((m) => m.source === "insurance");
  const pick = {
    id: "q1",
    policyId: "p1",
    partner: "demo",
    partnerQuoteId: "demo-q",
    carrier: {
      id: "demo-lighthouse",
      name: "Lighthouse Insurance (demo)",
      rating: "A+",
      ratingScore: 95,
      claimsPhone: "1-800-555-0101",
      claimsUrl: "https://example.com",
    },
    kind: "auto" as const,
    premiumCents: 10_800,
    premiumFrequency: "monthly" as const,
    annualPremiumCents: 129_600,
    termMonths: 12,
    deductibleCents: 100_000,
    coverage: {},
    sameCover: true,
    differences: [],
    demo: true,
    expiresAt: new Date("2026-11-18T00:00:00Z"),
    createdAt: new Date("2026-10-19T00:00:00Z"),
    plan: null,
    expectedCostCents: null,
  };
  const shop = (over: Partial<Shop> = {}): Shop => ({
    id: "s1",
    policyId: "p1",
    reason: "renewal",
    status: "open",
    currentAnnualCents: 170_400,
    pick,
    runnersUp: [],
    savingCents: 40_800,
    why: ["Line one.", "Line two.", "Line three."],
    quoteCount: 4,
    demo: true,
    expiresAt: pick.expiresAt,
    createdAt: pick.createdAt,
    ...over,
  });
  const withShops = (shops: Shop[], noBetter: Shop[] = []) =>
    snapshot({
      insurance: { ...insurance([policy()], household(), true, true), shops, noBetter },
    });

  it("asks once about a cheaper policy, with Yes, Show options and Not now, labelled advice", () => {
    const [message] = messages(withShops([shop()]));
    expect(message).toMatchObject({
      kind: "decision",
      dedupeKey: "insurance:shop:s1",
      priority: MESSAGE_PRIORITY.insurance_shop,
      refs: { insuranceShopId: "s1", policyId: "p1", advice: true },
    });
    expect(message.body.split("\n")).toEqual([
      "I found car insurance $408.00 a year cheaper for the same cover: Lighthouse Insurance (demo), at $108.00 a month.",
      "- Line one.",
      "- Line two.",
      "- Line three.",
      "These are sample quotes from my demo carrier catalog, not real offers.",
      "Say yes and I'll switch you. Your GEICO policy stays in place until the new one is.",
    ]);
    expect(message.actions).toEqual([
      { id: "insurance.shop_yes", label: "Yes, switch", kind: "primary" },
      { id: "open", label: "Show options", kind: "link", href: "/insurance/quotes?policy=p1" },
      { id: "insurance.shop_no", label: "Not now", kind: "secondary" },
    ]);
  });

  it("says when a reshop found nothing better", () => {
    const [message] = messages(
      withShops([], [shop({ status: "no_better", pick: null, savingCents: null })]),
    );
    expect(message).toMatchObject({ kind: "done", dedupeKey: "insurance:checked:s1" });
    expect(message.body).toBe(
      "I shopped your GEICO car insurance before it renews on Nov 28: of 4 quotes, nothing with the same cover saved enough to switch. I'll look again next time.",
    );
  });

  it("asks instead of the generic insurance finding when Jane shops by herself", () => {
    const finding = {
      findingId: "f1",
      type: "insurance_reshop" as const,
      title: "Your GEICO insurance could cost less",
      annualSavingsCents: null,
      savings: "",
      fingerprint: "x",
      urgent: false,
      pick: null,
    };
    const findings = (s: Snapshot) =>
      gather(s, MORNING, SYNC).filter((m) => m.source === "findings");
    expect(findings(snapshot({ findings: [finding] }))).toHaveLength(1);
    expect(findings({ ...withShops([]), findings: [finding] })).toEqual([]);
  });
});

describe("Jane's switches in the chat (spec step 105)", () => {
  const messages = (s: Snapshot) =>
    gather(s, MORNING, SYNC).filter((m) => m.source === "insurance");
  const sw = (status: "pending" | "active") => ({
    policyId: "new1",
    kind: "auto",
    carrier: "Lighthouse Insurance (demo)",
    status,
    startsOn: "2026-11-28",
    replaces: "GEICO",
    actionId: "a1",
  });
  const withSwitches = (switches: ReturnType<typeof sw>[]) =>
    snapshot({ insurance: { ...insurance(), switches } });

  it("says what Jane bought, then that the switch is done with no gap in cover", () => {
    const [bound] = messages(withSwitches([sw("pending")]));
    expect(bound).toMatchObject({
      kind: "done",
      dedupeKey: "insurance:bound:new1",
      refs: { policyId: "new1", actionId: "a1" },
    });
    expect(bound.body).toBe(
      "I've bought your new Lighthouse Insurance (demo) car insurance, starting Nov 28. GEICO stays in place until its first payment goes through; then I cancel it from the same day, so you're never without cover.",
    );
    const [done] = messages(withSwitches([sw("active")]));
    expect(done.dedupeKey).toBe("insurance:switched:new1");
    expect(done.body).toMatch(/and I cancelled GEICO from Nov 28\. No gap in cover\.$/);
  });

  it("reads how a switch is going, and answers from the switches", () => {
    for (const text of [
      "how's my insurance switch going",
      "did you switch my car insurance",
      "is the insurance switch done yet",
    ]) {
      expect(parseInsurance(normalize(text))?.ask, text).toBe("switch");
    }
    expect(parseInsurance("switch my car insurance")?.ask).toBe("quotes");
    const ask = parseInsurance("how's my insurance switch going")!;
    // Without an insurance word it may be a phone plan's switch (spec step 77).
    expect(parseInsurance("how's my switch going")).toBeNull();
    expect(insuranceReply(ask, { ...insurance(), switches: [sw("pending")] }, ASOF).body).toBe(
      "I bought your new Lighthouse Insurance (demo) car insurance, starting Nov 28, 2026. GEICO stays in place until its first payment goes through; then I cancel it from that day.",
    );
    expect(insuranceReply(ask, insurance(), ASOF).body).toMatch(
      /^I'm not switching any of your insurance/,
    );
  });
});

describe("the coverage checkup in the chat (spec step 106)", () => {
  const messages = (s: Snapshot) =>
    gather(s, MORNING, SYNC).filter((m) => m.source === "insurance");
  const rec = {
    key: "deductible_up" as const,
    policyId: "p1",
    kind: "auto" as const,
    title: "Raise the deductible on your GEICO car insurance to $2,500.00.",
    costCents: -18_933,
    cost: "Saves about $189.33 a year",
    risk: "On a claim you'd pay up to $1,500.00 more yourself.",
    cents: [],
  };
  const checkup = (recommendations: (typeof rec)[]) => ({
    id: "c1",
    reason: "yearly" as const,
    recommendations,
    seenAt: null,
    createdAt: MORNING,
  });

  it("says each recommendation with its cost and risk, labelled, with Got it", () => {
    const [message] = messages(
      snapshot({ insurance: { ...insurance(), checkup: checkup([rec]) } }),
    );
    expect(message).toMatchObject({
      kind: "heads_up",
      dedupeKey: "insurance:checkup:c1",
      refs: { insuranceCheckupId: "c1", advice: true },
      priority: MESSAGE_PRIORITY.insurance_checkup,
    });
    expect(message.body.split("\n")).toEqual([
      "I checked your insurance for the year. One thing is worth a look:",
      "- Raise the deductible on your GEICO car insurance to $2,500.00. Saves about $189.33 a year. On a claim you'd pay up to $1,500.00 more yourself.",
      "Nothing changes unless you say so.",
    ]);
    expect(message.actions.map((a) => a.id)).toEqual(["insurance.checkup_seen", "open"]);
  });

  it("says when there's nothing to change", () => {
    const [message] = messages(snapshot({ insurance: { ...insurance(), checkup: checkup([]) } }));
    expect(message.kind).toBe("done");
    expect(message.body).toMatch(/^I checked your insurance for the year: nothing to change\./);
  });

  it("reads checkup questions", () => {
    for (const text of [
      "check my insurance",
      "insurance checkup",
      "am I over-insured",
      "do I have the right amount of coverage",
    ]) {
      expect(parseIntent(text, ASOF), text).toMatchObject({ kind: "insurance", ask: "checkup" });
    }
    expect(parseIntent("what's my deductible", ASOF)).toMatchObject({ ask: "deductible" });
    // Raising it is a saving (spec step 196), shown both ways with a tap, not just a checkup line.
    expect(parseIntent("should I raise my deductible", ASOF)).toMatchObject({
      kind: "decision",
      item: "insurance",
    });
  });
});

it("leaves a check-up on other things alone", () => {
  expect(parseIntent("can you check up on my budget", ASOF).kind).not.toBe("insurance");
});

describe("insurance on autopilot (spec step 108)", () => {
  it("reads what Jane does by herself and how to reach the insurer", () => {
    expect(parseIntent("what do you do with my insurance on your own", ASOF)).toMatchObject({
      kind: "insurance",
      ask: "autopilot",
    });
    expect(parseIntent("what's my claims number for my car insurance", ASOF)).toMatchObject({
      ask: "contact",
      policyKind: "auto",
    });
  });

  it("says the level and that buying always takes a tap", () => {
    expect(autopilotReply("safe").body).toMatch(
      /^With insurance, I do this by myself at "Handle the safe stuff"\. I watch every renewal/,
    );
    expect(autopilotReply(null).body).toContain("at no autopilot level yet");
    for (const level of ["ask", "safe", "all", "custom", null]) {
      expect(autopilotReply(level).body).toMatch(
        /I never buy, change or cancel cover without your tap\.$/,
      );
    }
  });

  it("gives a catalog carrier's claims line", () => {
    const reply = insuranceReply(
      { kind: "insurance", ask: "contact", policyKind: null },
      insurance([policy({ carrier: "Lighthouse Insurance (demo)" })]),
      ASOF,
    );
    expect(reply.body).toContain(
      "- Lighthouse Insurance (demo) car insurance: claims line 1-800-555-0101",
    );
  });
});

describe("do I need it? (spec step 149)", () => {
  it.each([["do we need life insurance", "life"]])("reads %j", (text, policyKind) => {
    expect(parseIntent(text, ASOF)).toEqual({ kind: "insurance", ask: "need", policyKind });
  });

  it("reads 'is travel insurance worth it' as a decision", () => {
    expect(parseIntent("is travel insurance worth it", ASOF).kind).toBe("decision");
  });

  // These get a short, direct answer (./decisions.ts).
  it.each([
    ["do I need umbrella insurance", "umbrella"],
    ["do I need disability insurance", "disability"],
    ["do I need pet insurance", "pet"],
  ])("answers %j directly", (text, decision) => {
    expect(parseIntent(text, ASOF)).toMatchObject({ kind: "insurance", ask: "decide", decision });
  });

  // "Should I ...?" goes through the decision router, which hands insurance its own.
  it.each(["should I get disability insurance", "should I cancel my phone insurance"])(
    "hands %j to the decision router",
    (text) => {
      expect(parseIntent(text, ASOF)).toMatchObject({ kind: "decision", item: "insurance" });
    },
  );

  it("says when they already have it", () => {
    const ask = parseIntent("do I need car insurance", ASOF) as Parameters<
      typeof insuranceReply
    >[0];
    expect(insuranceReply(ask, insurance(), ASOF).body).toMatch(
      /^You already have GEICO car insurance\./,
    );
  });

  it("lists several gaps briefly, each a question away", () => {
    const facts = resolveHousehold(
      { housing: "rent", vehicles: null, dependants: 1, pets: null, dismissedGaps: [] },
      { mortgage: false, homeOwned: false, rentPaid: false, cars: 0, paycheck: true },
    );
    const reply = insuranceReply(
      parseInsurance("am i missing any insurance")!,
      insurance([], facts, true),
      ASOF,
    );
    expect(reply.body.split("\n")).toEqual([
      "3 things look missing from your cover.",
      "- No renters insurance on file",
      "- No life insurance on file",
      "- No disability insurance on file",
      'Ask me about any of them, like "do I need renters insurance?"',
    ]);
    expect(reply.refs).toEqual({});
  });
});

it("reads comparing health plans as quotes (spec step 149)", () => {
  expect(parseIntent("compare health plans", ASOF)).toEqual({
    kind: "insurance",
    ask: "quotes",
    policyKind: "health",
  });
});
