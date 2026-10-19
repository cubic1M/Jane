import { describe, expect, it, vi } from "vitest";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import {
  demoInvestments,
  demoFeeTransactions,
  demoInvestmentSnapshot,
  noInvestments,
} from "@/lib/investments/__fixtures__/demo";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/investments/holdings", () => ({ loadInvestments: vi.fn() }));
vi.mock("@/lib/investments/profile", () => ({ profileOf: vi.fn() }));
vi.mock("@/lib/investments/fees", () => ({ loadFees: vi.fn() }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn() }));
vi.mock("@/lib/investments/review", () => ({ loadReview: vi.fn() }));
vi.mock("@/lib/investments/retirement", () => ({ loadRetirement: vi.fn() }));
vi.mock("@/lib/investments/rebalance", () => ({ loadRebalance: vi.fn() }));
vi.mock("@/lib/investments/auto-invest", () => ({ loadAutoInvest: vi.fn() }));

import { loadInvestments } from "@/lib/investments/holdings";
import { profileOf } from "@/lib/investments/profile";
import { loadFees } from "@/lib/investments/fees";
import { adviceMode } from "@/lib/advice-mode";
import { feeSummary } from "@/insights/investment-fees";
import { reviewPortfolio } from "@/insights/portfolio-review";
import { loadReview } from "@/lib/investments/review";
import { loadRetirement } from "@/lib/investments/retirement";
import { retirementPlan } from "@/planning/retirement";
import { loadRebalance } from "@/lib/investments/rebalance";
import { loadAutoInvest } from "@/lib/investments/auto-invest";
import type { InvestmentSnapshot } from "./snapshot";
import { rebalancePlan } from "@/insights/rebalance";
import { FUND_FACTS } from "@/config/funds";
import { EMPTY_ANSWERS, profileSummary, type ProfileAnswers } from "@/planning/investor-profile";
import {
  autoInvestReply,
  feesReply,
  profileReply,
  rebalanceReply,
  retirementReply,
  reviewReply,
} from "./replies";
import { gather } from "../brain";
import { parseIntent } from "../intents";
import type { Snapshot } from "../snapshot";
import { investmentsSource } from "../sources/investments";
import { holdingsReply, matchAccounts } from "./replies";
import { INVESTMENT_TOOLS, runInvestmentTool } from "./tools";
import { CHAT_PAGES, CHAT_TOOLS, proposeAction } from "../claude-tools";
import type { PrismaClient } from "@/generated/prisma/client";

// Spec step 128: what the person owns, in Jane's chat.

const ASOF = "2026-10-19";

describe("investment questions, by rules", () => {
  it.each([
    ["what do I own", null],
    ["what's in my 401k", "401k"],
    ["What's in my 401(k)?", "401(k)"],
    ["how much is in my brokerage", "brokerage"],
    ["how much do I have in my IRA", "ira"],
    ["show me my investments", null],
    ["my portfolio", null],
    ["Jane, what am I invested in?", null],
    ["holdings", null],
  ])("reads %j as holdings", (text, account) => {
    expect(parseIntent(text, ASOF)).toEqual({ kind: "investments", topic: "holdings", account });
  });

  it.each([
    "how much can I spend",
    "can I afford $500 for my brokerage fees",
    "how much did I spend on food",
    "cancel Hulu",
    "change my goals",
  ])("leaves %j to the other rules", (text) => {
    expect(parseIntent(text, ASOF).kind).not.toBe("investments");
  });
});

describe("holdingsReply", () => {
  const data = demoInvestments();

  it("totals every account, with the biggest holdings and a link", () => {
    const reply = holdingsReply(data, null);
    expect(reply.body).toMatch(/^You have \$96,730\.55 across 2 accounts/);
    expect(reply.body).toContain("Demo 401(k): $84,250.40");
    expect(reply.body).toContain("Northstar Target 2055 Fund (NSTDX): $38,268.07");
    expect(reply.actions).toEqual([
      { id: "open", label: "See what you own", kind: "link", href: "/investments" },
    ]);
  });

  it("lists one account's holdings when the person names it", () => {
    const reply = holdingsReply(data, "401k");
    expect(reply.body).toMatch(/^Your Demo 401\(k\) has \$84,250\.40 in 5 holdings:/);
    expect(reply.body).toContain("From Demo Bank (fake data).");
    expect(holdingsReply(data, "brokerage").body).toMatch(/^Your Demo Brokerage has \$12,480\.15/);
    expect(holdingsReply(data, "retirement").body).toMatch(/^Your Demo 401\(k\)/);
  });

  it("says when there's no such account, or none at all", () => {
    expect(holdingsReply(data, "ira").body).toMatch(/^I don't see a ira among your accounts/);
    expect(holdingsReply(noInvestments(), null)).toMatchObject({
      body: expect.stringMatching(/^I don't see any investment/),
      actions: [{ href: "/connect" }],
    });
  });

  it("matches accounts by the words people use", () => {
    expect(matchAccounts(data.accounts, "401(k)").map((a) => a.name)).toEqual(["Demo 401(k)"]);
    expect(matchAccounts(data.accounts, null)).toHaveLength(2);
  });
});

const base = {
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
} as Snapshot;

describe("the investments message", () => {
  const now = new Date("2026-10-19T13:00:00Z");

  it("says once that Jane can see what's in the accounts", () => {
    const data = demoInvestments();
    const [message] = gather(
      {
        ...base,
        investments: demoInvestmentSnapshot({ advice: false }),
      },
      now,
      { trigger: "sync", sources: [investmentsSource] },
    );
    expect(message).toMatchObject({
      kind: "heads_up",
      dedupeKey: "investments:holdings",
      priority: MESSAGE_PRIORITY.investments,
    });
    expect(message.body).toBe(
      "I can see what's in your investment accounts now: 9 holdings worth $96,730.55 in Demo 401(k) and Demo Brokerage. Every number shows where it came from, and I'll keep it up to date.",
    );
    expect(message.actions.map((a) => a.id)).toEqual(["open", "snooze"]);
  });

  it("stays quiet with no holdings", () => {
    expect(investmentsSource.gather(base, {} as never)).toEqual([]);
    expect(
      investmentsSource.gather(
        {
          ...base,
          investments: demoInvestmentSnapshot({ totalCents: 100, holdingCount: 0, accounts: [] }),
        },
        {} as never,
      ),
    ).toEqual([]);
  });
});

describe("Claude's holdings tool", () => {
  it("is offered in the chat, with a page to link to", () => {
    expect(CHAT_TOOLS.map((t) => t.name)).toEqual(
      expect.arrayContaining(INVESTMENT_TOOLS.map((t) => t.name)),
    );
    expect(CHAT_PAGES.investments.href).toBe("/investments");
  });

  it("returns every holding and records every dollar figure for the guardrails", async () => {
    vi.mocked(loadInvestments).mockResolvedValue(demoInvestments());
    const out = await runInvestmentTool(
      "u",
      "holdings",
      {},
      {
        client: {} as PrismaClient,
        now: new Date(),
      },
    );
    const parsed = JSON.parse(out.content);
    expect(parsed.total).toBe("$96,730.55");
    expect(parsed.accounts[0].holdings[0]).toMatchObject({
      name: "Northstar Target 2055 Fund",
      yearlyCost: "0.75%",
      source: "Demo Bank (fake data), Demo 401(k), price as of Oct 18, 2026",
    });
    expect(out.cents).toEqual(expect.arrayContaining([9_673_055, 3_826_807]));
  });

  it("says when nothing is linked", async () => {
    vi.mocked(loadInvestments).mockResolvedValue(noInvestments());
    const out = await runInvestmentTool(
      "u",
      "holdings",
      {},
      {
        client: {} as PrismaClient,
        now: new Date(),
      },
    );
    expect(JSON.parse(out.content)).toEqual({
      note: "No investment or retirement accounts are linked.",
    });
  });
});

// Spec step 129: what the investments are for.
const FULL: ProfileAnswers = {
  age: 45,
  ageOn: "2026-10-19",
  horizon: "10_to_20",
  dropReaction: "worry",
  goals: ["retirement"],
  answeredAt: new Date("2026-10-19T12:00:00Z"),
  updatedAt: new Date("2026-10-19T12:00:00Z"),
};

describe("investor-profile questions, by rules", () => {
  it.each([
    "what's my risk profile",
    "my risk tolerance",
    "how much risk should I take",
    "change my investing goals",
    "update my investor profile",
    "change my risk",
    "answer the questions",
  ])("reads %j as the profile", (text) => {
    expect(parseIntent(text, ASOF)).toEqual({
      kind: "investments",
      topic: "profile",
      account: null,
    });
  });
});

describe("profileReply", () => {
  it("asks the next question, with its answer buttons, until all four are in", () => {
    const first = profileReply(EMPTY_ANSWERS, ASOF);
    expect(first.body).toMatch(/^Before I check whether your investments fit you/);
    expect(first.refs).toEqual({ investQuestion: "age", note: "1 of 4: How old are you?" });
    expect(first.actions.map((a) => a.label)).toEqual([
      "Under 30",
      "30s",
      "40s",
      "50s",
      "60 or over",
      "Answer on the profile page",
    ]);
    expect(first.actions[0].id).toBe("invest.answer.1");
    const third = profileReply({ ...FULL, dropReaction: null, goals: [] }, ASOF);
    expect(third.body).toMatch(/^You've answered 2 of 4/);
    expect(third.refs.note).toBe(
      "3 of 4: If your investments fell 20% in a month, what would you do?",
    );
  });

  it("says the level, why, and where to change it once answered", () => {
    const reply = profileReply(FULL, ASOF);
    expect(reply.body).toBe(
      "Your investor profile: Moderate: you'd worry, but wait it out after a drop, so less risk than your timeline allows. A balance of growth and steadiness. Age 45; the money is for: Retirement.",
    );
    expect(reply.actions).toEqual([
      { id: "open", label: "Change it", kind: "link", href: "/investments/profile" },
    ]);
    expect(profileReply(FULL, "2027-11-01").body).toMatch(/It's been a year/);
  });
});

describe("the investor-profile question in the chat", () => {
  const inv = (advice: boolean, profile: ProfileAnswers) =>
    demoInvestmentSnapshot({ advice, profile });
  const ask = (advice: boolean, profile: ProfileAnswers, asOf = ASOF) =>
    investmentsSource
      .gather({ ...base, asOf, investments: inv(advice, profile) }, {} as never)
      .filter((c) => c.kind === "decision");

  it("asks in demo advice mode, once there are holdings, until all four are in", () => {
    const [message] = ask(true, EMPTY_ANSWERS);
    expect(message).toMatchObject({
      dedupeKey: "profile",
      priority: MESSAGE_PRIORITY.investment_profile,
      refs: { investQuestion: "age" },
    });
    expect(message.actions.at(-1)?.id).toBe("snooze");
    expect(ask(true, { ...FULL, goals: [] })[0].refs.investQuestion).toBe("goal");
    expect(ask(true, FULL)).toEqual([]);
  });

  it("never asks real accounts, which get no advice", () => {
    expect(ask(false, EMPTY_ANSWERS)).toEqual([]);
  });

  it("goes through all four again a year after the last change", () => {
    const [message] = ask(true, FULL, "2027-10-20");
    expect(message).toMatchObject({
      dedupeKey: "profile:2027",
      refs: { investQuestion: "age", investAgain: true },
    });
  });
});

describe("Claude's investor_profile tool", () => {
  it("says it isn't finished, so nothing is recommended from it", async () => {
    vi.mocked(profileOf).mockResolvedValue({ ...FULL, goals: [] });
    const out = await runInvestmentTool(
      "u",
      "investor_profile",
      {},
      {
        client: {} as PrismaClient,
        now: new Date("2026-10-19T12:00:00Z"),
      },
    );
    expect(JSON.parse(out.content)).toMatchObject({
      complete: false,
      answered: 3,
      nextQuestion: "What's this money mostly for?",
    });
  });

  it("gives the level and the answers once complete", async () => {
    vi.mocked(profileOf).mockResolvedValue(FULL);
    const out = await runInvestmentTool(
      "u",
      "investor_profile",
      {},
      {
        client: {} as PrismaClient,
        now: new Date("2026-10-19T12:00:00Z"),
      },
    );
    expect(JSON.parse(out.content)).toEqual({
      complete: true,
      riskLevel: "Moderate",
      why: "Moderate: you'd worry, but wait it out after a drop, so less risk than your timeline allows.",
      age: 45,
      needsTheMoney: "In 10 to 20 years",
      goals: ["Retirement"],
      answeredOverAYearAgo: false,
    });
  });
});

// Spec step 130: what investing costs.
describe("fee questions, by rules", () => {
  it.each([
    ["what are my investment fees", null],
    ["what's the expense ratio on my funds", null],
    ["401k fees", "401k"],
    ["how much am I paying for my brokerage", "brokerage"],
    ["are there cheaper funds", null],
  ])("reads %j as fees", (text, account) => {
    expect(parseIntent(text, ASOF)).toEqual({ kind: "investments", topic: "fees", account });
  });

  it.each(["lower my bank fees", "how much did I spend on fees", "refund the overdraft fee"])(
    "leaves %j to the other rules",
    (text) => {
      expect(parseIntent(text, ASOF).kind).not.toBe("investments");
    },
  );
});

describe("feesReply", () => {
  const data = demoInvestments();
  const fees = feeSummary(data.accounts, demoFeeTransactions());

  it("gives the yearly cost, the 30-year range and the costliest funds, for everyone", () => {
    const reply = feesReply(fees, false);
    expect(reply.body).toMatch(
      /^Your investments cost about \$[\d,.]+ a year: \$[\d,.]+ in fund costs, \$124\.80 in advisory fees, \$50\.00 in account fees\. Over 30 years that's roughly \$[\d,.]+ to \$[\d,.]+ with growth, depending on returns\./,
    );
    expect(reply.body).toContain("- Northstar Target 2055 Fund: 0.75%");
    expect(reply.body).not.toContain("equivalent");
    expect(reply.refs).toEqual({});
    expect(reply.actions[0]).toMatchObject({ href: "/investments/fees" });
  });

  it("adds the lower-cost equivalents in demo advice mode, labelled", () => {
    const reply = feesReply(fees, true);
    expect(reply.body).toContain("Lower-cost equivalents:");
    expect(reply.body).toContain(
      "- Summit Large Cap Growth Fund in your Demo 401(k) charges 1.02% a year; Keystone Total US Stock Index Fund (US total stock market index, offered in your plan) charges 0.03%.",
    );
    expect(reply.body).toMatch(/Switching those 3 funds could save about \$[\d,.]+ a year/);
    expect(reply.refs).toEqual({ advice: true });
  });

  it("says when there are no fees to show", () => {
    expect(feesReply(feeSummary([], []), true).body).toMatch(/^I don't see any investment fees/);
  });
});

describe("the fees message", () => {
  const gatherFees = (advice: boolean) =>
    investmentsSource
      .gather({ ...base, investments: demoInvestmentSnapshot({ advice }) }, {} as never)
      .filter((c) => c.dedupeKey.startsWith("fees:"));

  it("says once, in demo advice mode, what switching costly funds could save", () => {
    const [message] = gatherFees(true);
    expect(message).toMatchObject({
      kind: "heads_up",
      refs: { advice: true },
      priority: MESSAGE_PRIORITY.investment_fees,
      dedupeKey: "fees:NSTDX>KTRGX,PDIFX>KDVX,SLGFX>KTSIX",
    });
    expect(message.body).toMatch(
      /^Your investments cost about \$[\d,.]+ a year in fees\. Northstar Target 2055 Fund in your Demo 401\(k\) charges 0\.75% a year; Keystone Target 2055 Index Fund/,
    );
    expect(message.body).toContain("I found 2 more like it.");
    expect(message.body).toMatch(
      /roughly \$[\d,.]+ to \$[\d,.]+ over 30 years depending on returns\.$/,
    );
  });

  it("never recommends to real accounts", () => {
    expect(gatherFees(false)).toEqual([]);
  });
});

describe("Claude's investment_fees tool", () => {
  it("records every figure, and gives equivalents only in demo advice mode", async () => {
    vi.mocked(loadFees).mockResolvedValue({
      investments: demoInvestments(),
      fees: feeSummary(demoInvestments().accounts, demoFeeTransactions()),
    });
    vi.mocked(adviceMode).mockResolvedValue(false);
    const options = { client: {} as PrismaClient, now: new Date("2026-10-19T12:00:00Z") };
    const plain = await runInvestmentTool("u", "investment_fees", {}, options);
    const parsed = JSON.parse(plain.content);
    expect(parsed.advisoryFeesLast12Months).toBe("$124.80");
    expect(parsed.over30Years.low).toMatch(/^\$/);
    expect(parsed.lowerCostEquivalents).toMatch(/demo advice mode only/);
    expect(plain.cents).toContain(12_480);

    vi.mocked(adviceMode).mockResolvedValue(true);
    const advice = JSON.parse(
      (await runInvestmentTool("u", "investment_fees", {}, options)).content,
    );
    expect(advice.lowerCostEquivalents[0]).toMatchObject({
      instead: "Northstar Target 2055 Fund",
      hold: "Keystone Target 2055 Index Fund",
      offeredInPlan: true,
    });
  });
});

// Spec step 131: does it fit?
describe("review questions, by rules", () => {
  it.each([
    "review my portfolio",
    "is my portfolio balanced",
    "am I diversified",
    "what's my asset allocation",
    "how should I invest",
    "what should I do with my 401k",
  ])("reads %j as the review", (text) => {
    expect(parseIntent(text, ASOF)).toEqual({
      kind: "investments",
      topic: "review",
      account: null,
    });
  });
});

describe("reviewReply", () => {
  const data = demoInvestments();
  const done = profileSummary(FULL, ASOF);
  const review = reviewPortfolio(data.accounts, 3);

  it("gives real accounts their mix and no recommendation", () => {
    const reply = reviewReply(data, done, review, false);
    expect(reply.body).toMatch(/^Here's your mix: \$[\d,.]+ in US stocks, /);
    expect(reply.body).toContain("I don't give investment recommendations on real accounts yet.");
    expect(reply.refs).toEqual({});
  });

  it("asks the profile questions first in demo advice mode", () => {
    const reply = reviewReply(data, profileSummary(EMPTY_ANSWERS, ASOF), null, true);
    expect(reply.body).toMatch(
      /^To check whether your investments fit you, I need four quick answers first/,
    );
    expect(reply.refs.investQuestion).toBe("age");
    expect(reply.actions[0].id).toBe("invest.answer.1");
  });

  it("says what to change and why once the profile is in, labelled", () => {
    const reply = reviewReply(data, done, review, true);
    expect(reply.body).toMatch(
      /^Against your moderate profile: US stocks 69% \(target 40%\), international stocks 14% \(target 20%\), bonds 10% \(target 35%\), cash 7% \(target 5%\)\.\nWhat I'd change:\n1\. Move about/,
    );
    expect(reply.refs).toEqual({ advice: true });
  });
});

describe("the review message", () => {
  const review = reviewPortfolio(demoInvestments().accounts, 3);
  const gatherReview = (advice: boolean, r = review) =>
    investmentsSource
      .gather({ ...base, investments: demoInvestmentSnapshot({ advice, review: r }) }, {} as never)
      .filter((c) => c.dedupeKey.startsWith("review:"));

  it("says the first change and why, once, in demo advice mode", () => {
    const [message] = gatherReview(true);
    expect(message).toMatchObject({
      dedupeKey: "review:3:rebalance",
      refs: { advice: true },
      priority: MESSAGE_PRIORITY.investment_review,
    });
    expect(message.body).toMatch(
      /^I've reviewed your investments against your moderate profile\. Move about/,
    );
    expect(message.actions[0]).toMatchObject({ href: "/investments/review" });
  });

  it("stays quiet for real accounts, before the profile, and on target", () => {
    expect(gatherReview(false)).toEqual([]);
    expect(gatherReview(true, null as never)).toEqual([]);
    expect(gatherReview(true, { ...review, recommendations: [] })).toEqual([]);
  });
});

describe("Claude's portfolio_review tool", () => {
  const options = { client: {} as PrismaClient, now: new Date("2026-10-19T12:00:00Z") };

  it("is for demo advice mode only, after the profile", async () => {
    vi.mocked(adviceMode).mockResolvedValue(false);
    vi.mocked(loadReview).mockResolvedValue({
      investments: demoInvestments(),
      profile: profileSummary(FULL, ASOF),
      review: reviewPortfolio(demoInvestments().accounts, 3),
    });
    expect(
      JSON.parse((await runInvestmentTool("u", "portfolio_review", {}, options)).content),
    ).toEqual({
      note: "Reviews are for demo advice mode only.",
    });
    vi.mocked(adviceMode).mockResolvedValue(true);
    const out = await runInvestmentTool("u", "portfolio_review", {}, options);
    const parsed = JSON.parse(out.content);
    expect(parsed.riskLevel).toBe("Moderate");
    expect(parsed.whatToChange[0].amount).toMatch(/^\$/);
    expect(out.cents).toContain(
      reviewPortfolio(demoInvestments().accounts, 3).recommendations[0].amountCents,
    );
  });
});

// Spec step 132: on track for retirement?
const DEMO_RETIREMENT = retirementPlan({
  age: 45,
  balanceCents: 8_425_040,
  employeeCents: 326_400,
  employerCents: 163_200,
  plan: { payCents: 8_160_000, matchRate: 0.5, matchUpTo: 0.06 },
});

describe("retirement questions, by rules", () => {
  it.each([
    "am I on track for retirement",
    "when can I retire",
    "am I getting my 401k match",
    "roth or traditional",
    "catch-up contributions",
    "how much should I put in my 401k",
  ])("reads %j as retirement", (text) => {
    expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "retirement" });
  });

  it("leaves what's in a retirement account to holdings", () => {
    expect(parseIntent("how much is in my retirement account", ASOF)).toMatchObject({
      topic: "holdings",
    });
  });
});

describe("retirementReply", () => {
  const data = {
    profile: profileSummary(FULL, ASOF),
    balanceCents: 8_425_040,
    accounts: ["Demo 401(k)"],
    retirement: DEMO_RETIREMENT,
  };

  it("gives the range, the match and what to change, labelled", () => {
    const reply = retirementReply(data, true);
    expect(reply.body).toMatch(
      /^By 67 your retirement accounts could be about \$[\d,.]+ to \$[\d,.]+ in today's dollars, depending on returns, short of the target of \$816,000\.00\. You're leaving about \$816\.00 a year of your employer's match on the table: you put in 4% of your pay, and they match up to 6%\.\nWhat I'd change:\n1\. Raise your 401\(k\) contribution from 4% to 6% of your pay\./,
    );
    expect(reply.body).toContain("A mix of Roth and traditional");
    expect(reply.refs).toEqual({ advice: true });
  });

  it("gives real accounts the balance only, and asks for the profile first", () => {
    expect(retirementReply(data, false).body).toBe(
      "You have $84,250.40 in Demo 401(k). My retirement planner is only in demo advice mode for now.",
    );
    const ask = retirementReply(
      { ...data, profile: profileSummary(EMPTY_ANSWERS, ASOF), retirement: null },
      true,
    );
    expect(ask.refs.investQuestion).toBe("age");
    expect(retirementReply({ ...data, accounts: [] }, true).actions[0]).toMatchObject({
      href: "/connect",
    });
  });
});

describe("the retirement message", () => {
  const gatherRetirement = (advice: boolean, retirement = DEMO_RETIREMENT) =>
    investmentsSource
      .gather({ ...base, investments: demoInvestmentSnapshot({ advice, retirement }) }, {} as never)
      .filter((c) => c.dedupeKey.startsWith("retirement:"));

  it("says when the person is behind or missing match money, with the first step", () => {
    const [message] = gatherRetirement(true);
    expect(message).toMatchObject({
      dedupeKey: "retirement:behind:false",
      refs: { advice: true },
      priority: MESSAGE_PRIORITY.retirement,
    });
    expect(message.body).toMatch(
      /match up to 6%\. First step: Raise your 401\(k\) contribution from 4% to 6% of your pay\.$/,
    );
  });

  it("stays quiet for real accounts and when all is well", () => {
    expect(gatherRetirement(false)).toEqual([]);
    const fine = retirementPlan({
      age: 45,
      balanceCents: 90_000_000,
      employeeCents: 489_600,
      employerCents: 244_800,
      plan: { payCents: 8_160_000, matchRate: 0.5, matchUpTo: 0.06 },
    });
    expect(gatherRetirement(true, fine)).toEqual([]);
  });
});

describe("Claude's retirement_plan tool", () => {
  it("records every figure, in demo advice mode only", async () => {
    const options = { client: {} as PrismaClient, now: new Date("2026-10-19T12:00:00Z") };
    vi.mocked(loadRetirement).mockResolvedValue({
      profile: profileSummary(FULL, ASOF),
      balanceCents: 8_425_040,
      accounts: ["Demo 401(k)"],
      retirement: DEMO_RETIREMENT,
    });
    vi.mocked(adviceMode).mockResolvedValue(false);
    expect(
      JSON.parse((await runInvestmentTool("u", "retirement_plan", {}, options)).content),
    ).toEqual({
      note: "The retirement planner is for demo advice mode only.",
    });
    vi.mocked(adviceMode).mockResolvedValue(true);
    const out = await runInvestmentTool("u", "retirement_plan", {}, options);
    const parsed = JSON.parse(out.content);
    expect(parsed.status).toBe("behind");
    expect(parsed.match.missedAYear).toBe("$816.00");
    for (const c of DEMO_RETIREMENT.changes) {
      for (const f of c.figures) expect(out.cents).toContain(f);
    }
  });
});

// Spec step 133: move to the recommended mix with one tap.
const PLAN = rebalancePlan(
  demoInvestments().accounts,
  3,
  (t) => FUND_FACTS[t]?.mix ?? { other: 1 },
);

describe("rebalance questions, by rules", () => {
  it.each(["rebalance", "rebalance my 401k", "move me to the recommended mix", "fix my portfolio"])(
    "reads %j as rebalancing",
    (text) => {
      expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "rebalance" });
    },
  );
});

describe("rebalanceReply", () => {
  it("offers the orders with the button, saying they're simulated", () => {
    const reply = rebalanceReply(true, PLAN, profileSummary(FULL, ASOF));
    expect(reply.body).toMatch(/^Here's the plan: \d+ orders: sell \$[\d,.]+ \(/);
    expect(reply.body).toContain(
      "After: 40% US stocks, 20% international stocks, 35% bonds, 5% cash.",
    );
    expect(reply.body).toMatch(
      /Tap and I'll place the orders in the simulated brokerage \(no real money moves\)\.$/,
    );
    expect(reply.actions[0]).toEqual({
      id: "invest.rebalance",
      label: "Move to the recommended mix",
      kind: "primary",
    });
    expect(reply.refs).toEqual({ advice: true, rebalanceKey: PLAN.key });
  });

  it("never offers trades to real accounts, asks for the profile first, and says when on target", () => {
    expect(
      rebalanceReply(false, PLAN, profileSummary(FULL, ASOF)).actions.map((a) => a.id),
    ).toEqual(["open"]);
    expect(
      rebalanceReply(true, null, profileSummary(EMPTY_ANSWERS, ASOF)).refs.investQuestion,
    ).toBe("age");
    expect(rebalanceReply(true, { ...PLAN, orders: [] }, profileSummary(FULL, ASOF)).body).toMatch(
      /^Your mix is already on target/,
    );
  });
});

describe("the review message with orders ready", () => {
  it("is a decision with the one-tap button and the plan's key", () => {
    const review = reviewPortfolio(demoInvestments().accounts, 3);
    const [message] = investmentsSource
      .gather(
        { ...base, investments: demoInvestmentSnapshot({ review, rebalance: PLAN }) },
        {} as never,
      )
      .filter((c) => c.dedupeKey.startsWith("review:"));
    expect(message).toMatchObject({
      kind: "decision",
      refs: { advice: true, rebalanceKey: PLAN.key },
    });
    expect(message.actions.map((a) => a.id)).toEqual(["invest.rebalance", "open", "snooze"]);
    expect(message.body).toContain(
      "Tap and I'll place them in the simulated brokerage (no real money moves).",
    );
  });
});

describe("Claude and rebalancing", () => {
  const options = { client: {} as PrismaClient, now: new Date("2026-10-19T12:00:00Z") };

  it("reads the plan, saying the brokerage is simulated", async () => {
    vi.mocked(loadRebalance).mockResolvedValue({
      advice: true,
      plan: PLAN,
      investments: demoInvestments(),
    });
    const out = await runInvestmentTool("u", "rebalance_plan", {}, options);
    const parsed = JSON.parse(out.content);
    expect(parsed.brokerage).toBe("simulated: no real money moves");
    expect(parsed.orders).toHaveLength(PLAN.orders.length);
    for (const o of PLAN.orders) expect(out.cents).toContain(o.amountCents);
  });

  it("can offer the button, only with a plan in demo advice mode", async () => {
    vi.mocked(loadRebalance).mockResolvedValue({
      advice: true,
      plan: PLAN,
      investments: demoInvestments(),
    });
    expect(await proposeAction("u", { action: "invest.rebalance" }, options)).toMatchObject({
      ok: true,
      refs: { rebalanceKey: PLAN.key },
    });
    vi.mocked(loadRebalance).mockResolvedValue({
      advice: false,
      plan: null,
      investments: demoInvestments(),
    });
    expect(await proposeAction("u", { action: "invest.rebalance" }, options)).toMatchObject({
      ok: false,
    });
  });
});

// Spec step 134: investing automatically.
const AUTO_DATA = {
  advice: true,
  profileComplete: true,
  plan: null,
  runs: [],
  accounts: [{ id: "b", name: "Demo Brokerage", subtype: "brokerage" }],
  suggestion: { amountCents: 10_000, accountId: "b" },
} as Awaited<ReturnType<typeof import("@/lib/investments/auto-invest").loadAutoInvest>>;
const RUN = {
  id: "r1",
  paydayOn: "2026-10-15",
  status: "invested",
  amountCents: 10_000,
  safeCents: 277_512,
  reason: null,
};

describe("automatic investing questions, by rules", () => {
  it.each([
    "invest automatically",
    "auto invest",
    "invest every payday",
    "pause investing",
    "turn on automatic investing",
  ])("reads %j as automatic investing", (text) => {
    expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "auto_invest" });
  });
});

describe("autoInvestReply", () => {
  it("offers to start, with the amount and the rest-after-bills choice", () => {
    const reply = autoInvestReply(AUTO_DATA);
    expect(reply.body).toMatch(
      /^I can invest \$100\.00 every payday for you, or the rest after bills and goals\. I'll only invest what safe to spend doesn't need/,
    );
    expect(reply.actions.map((a) => a.id)).toEqual([
      "invest.auto_start",
      "invest.auto_leftover",
      "open",
    ]);
    expect(reply.refs).toEqual({
      advice: true,
      autoInvest: { amountCents: 10_000, accountId: "b" },
    });
  });

  it("says what it does, with the last payday, and offers to pause or resume", () => {
    const on = autoInvestReply({
      ...AUTO_DATA,
      plan: {
        mode: "fixed",
        amountCents: 10_000,
        accountId: "b",
        status: "active",
        lastPaydayOn: null,
      },
      runs: [RUN],
    });
    expect(on.body).toMatch(/^Automatic investing is on: \$100\.00 every payday\./);
    expect(on.body).toContain(
      "Last: I invested $100.00 from your Oct 15 paycheck, in the simulated brokerage (no real money moved).",
    );
    expect(on.actions[0].id).toBe("invest.auto_pause");
    const off = autoInvestReply({
      ...AUTO_DATA,
      plan: {
        mode: "leftover",
        amountCents: null,
        accountId: "b",
        status: "paused",
        lastPaydayOn: null,
      },
    });
    expect(off.body).toBe("Automatic investing is paused (the rest after bills and goals).");
    expect(off.actions[0].id).toBe("invest.auto_resume");
  });

  it("never for real accounts, and asks for the profile first", () => {
    expect(autoInvestReply({ ...AUTO_DATA, advice: false }).body).toBe(
      "I don't invest automatically for real accounts yet.",
    );
    expect(autoInvestReply({ ...AUTO_DATA, profileComplete: false }).refs.investQuestion).toBe(
      "age",
    );
  });
});

describe("automatic investing in Jane's messages", () => {
  const gatherAuto = (over: Partial<InvestmentSnapshot>) =>
    investmentsSource
      .gather({ ...base, investments: demoInvestmentSnapshot(over) }, {} as never)
      .filter((c) => c.dedupeKey.startsWith("auto:"));

  it("offers once, in demo advice mode, after the profile", () => {
    const auto = {
      plan: null,
      runs: [],
      suggestion: AUTO_DATA.suggestion,
      accounts: AUTO_DATA.accounts,
    };
    const [offer] = gatherAuto({ profile: FULL, autoInvest: auto });
    expect(offer).toMatchObject({
      kind: "decision",
      dedupeKey: "auto:offer",
      refs: { advice: true, autoInvest: AUTO_DATA.suggestion },
      priority: MESSAGE_PRIORITY.auto_invest_offer,
    });
    expect(offer.body).toMatch(
      /^Want me to invest for you automatically\? \$100\.00 every payday into your Demo Brokerage/,
    );
    expect(gatherAuto({ advice: false, profile: FULL, autoInvest: auto })).toEqual([]);
    expect(gatherAuto({ profile: EMPTY_ANSWERS, autoInvest: auto })).toEqual([]);
  });

  it("says every payday's contribution, and every pause with its reason", () => {
    const plan = {
      mode: "fixed",
      amountCents: 10_000,
      accountId: "b",
      status: "active",
      lastPaydayOn: null,
    };
    const paused = {
      ...RUN,
      id: "r2",
      paydayOn: "2026-11-01",
      status: "paused",
      amountCents: 0,
      reason: "Safe to spend is $900, and I keep at least $1,000 of it for you.",
    };
    const messages = gatherAuto({
      profile: FULL,
      autoInvest: { plan, runs: [paused, RUN], suggestion: null, accounts: [] },
    });
    expect(messages.map((m) => [m.kind, m.dedupeKey, m.body])).toEqual([
      [
        "heads_up",
        "auto:run:r2",
        "I paused investing for your Nov 1 paycheck. Safe to spend is $900, and I keep at least $1,000 of it for you.",
      ],
      [
        "done",
        "auto:run:r1",
        "I invested $100.00 from your Oct 15 paycheck, in the simulated brokerage (no real money moved).",
      ],
    ]);
    expect(messages[0].actions.map((a) => a.id)).toEqual(["invest.auto_pause", "open"]);
  });
});

describe("Claude's auto_invest tool", () => {
  it("reports the plan and paydays, recording every figure", async () => {
    vi.mocked(loadAutoInvest).mockResolvedValue({
      ...AUTO_DATA,
      plan: {
        mode: "fixed",
        amountCents: 10_000,
        accountId: "b",
        status: "active",
        lastPaydayOn: null,
      },
      runs: [RUN],
    });
    const out = await runInvestmentTool(
      "u",
      "auto_invest",
      {},
      {
        client: {} as PrismaClient,
        now: new Date("2026-10-19T12:00:00Z"),
      },
    );
    const parsed = JSON.parse(out.content);
    expect(parsed.plan).toEqual({
      status: "active",
      mode: "a set amount",
      eachPayday: "$100.00",
      into: "Demo Brokerage",
    });
    expect(parsed.brokerage).toBe("simulated: no real money moves");
    expect(out.cents).toEqual(expect.arrayContaining([10_000, 277_512]));
  });
});
