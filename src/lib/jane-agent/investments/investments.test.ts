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
vi.mock("@/lib/investments/accounts", () => ({ loadAccountPlan: vi.fn() }));
vi.mock("@/lib/investments/returns", () => ({ loadReturns: vi.fn() }));
vi.mock("@/lib/investments/goal-buckets", () => ({ loadGoalBuckets: vi.fn() }));

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
import { loadAccountPlan } from "@/lib/investments/accounts";
import { accountOrder, assetLocation, unrealisedGains } from "@/planning/account-order";
import type { InvestmentSnapshot } from "./snapshot";
import { rebalancePlan } from "@/insights/rebalance";
import { FUND_FACTS } from "@/config/funds";
import { EMPTY_ANSWERS, profileSummary, type ProfileAnswers } from "@/planning/investor-profile";
import {
  accountsReply,
  autoInvestReply,
  autopilotReply,
  overviewReply,
  feesReply,
  profileReply,
  rebalanceReply,
  retirementReply,
  reviewReply,
  returnsReply,
  goalBucketsReply,
  collegeReply,
  hsaReply,
  companyStockReply,
  cryptoReply,
  cashReply,
  steadyReply,
  retirementAccountsReply,
  oldAccountsReply,
  retirementIncomeReply,
  familyReply,
  propertyReply,
  costlyReply,
  yearlyReviewReply,
  locationReply,
} from "./replies";
import { gather } from "../brain";
import { parseIntent } from "../intents";
import type { Snapshot } from "../snapshot";
import { investmentsSource } from "../sources/investments";
import { concentration, diversifyPlan } from "@/planning/company-stock";
import { cryptoFees, cryptoSize } from "@/insights/crypto";
import { cashPlan } from "@/planning/cash";
import {
  exitComparison,
  feeGap,
  surrenderByYear,
  wholeLifeCompare,
} from "@/planning/costly-products";
import { productLine } from "./costly-copy";
import { locationPlan, type PlanAccount } from "@/planning/location";
import { holdingsReply, matchAccounts } from "./replies";
import { INVESTMENT_TOOLS, runInvestmentTool } from "./tools";
import { CHAT_PAGES, CHAT_TOOLS, proposeAction } from "../claude-tools";
import { learnLink, learnReply } from "../learn";
import { goalBuckets } from "@/planning/goal-buckets";
import { comparePlans } from "@/planning/college";
import { hsaPlan } from "@/planning/hsa";
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
    expect(reply.body).toMatch(
      /^Your Demo 401\(k\) has \$84,250\.40 in 5 holdings\. Biggest first:/,
    );
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
      source: "Demo Bank (fake data), Demo 401(k), price as of Oct 17, 2026",
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
    ["what fees am I paying on my investments", null],
    ["what fees do I pay on my 401k", "401k"],
  ])("reads %j as fees", (text, account) => {
    expect(parseIntent(text, ASOF)).toEqual({ kind: "investments", topic: "fees", account });
  });

  it.each([
    "lower my bank fees",
    "how much did I spend on fees",
    "refund the overdraft fee",
    "what fees did I pay on my checking",
  ])("leaves %j to the other rules", (text) => {
    expect(parseIntent(text, ASOF).kind).not.toBe("investments");
  });
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
      dedupeKey: "review:3:rebalance:2026-10",
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
    expect(reply.body).toMatch(
      /^I've got \d+ orders ready to move you to your moderate mix, in the simulated brokerage \(no real money moves\)\.\n\d+ orders: sell \$[\d,.]+ \(/,
    );
    expect(reply.body).toContain(
      "After: 40% US stocks, 20% international stocks, 35% bonds, 5% cash.",
    );
    expect(reply.body).toMatch(/Tap and I'll place them\.$/);
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
    expect(message.actions.map((a) => a.id)).toEqual([
      "invest.rebalance",
      "open",
      "open",
      "snooze",
    ]);
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
        updatedAt: new Date("2026-10-15T00:00:00Z"),
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
        updatedAt: new Date("2026-10-15T00:00:00Z"),
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
      updatedAt: new Date("2026-10-15T00:00:00Z"),
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
        updatedAt: new Date("2026-10-15T00:00:00Z"),
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

// Spec step 135: which account first.
const ORDER = accountOrder({
  age: 45,
  horizon: "over_20",
  goals: ["retirement"],
  marginalRate: 0.22,
  match: { captured: false, missedCents: 81_600, fullMatchRate: 0.06, employeeRate: 0.04 },
  employeeCents: 326_400,
  catchUpCents: 0,
  hasHsa: false,
});
const ACCOUNT_PLAN = {
  advice: true,
  profile: profileSummary(FULL, ASOF),
  marginalRate: 0.22,
  rothOrTraditional: "mix" as const,
  order: ORDER,
  location: assetLocation(demoInvestments().accounts, 0.22),
  gains: unrealisedGains(demoInvestments().accounts),
};

describe("account questions, by rules", () => {
  it.each([
    "which account should I invest in first",
    "where should I put my extra money",
    "401k or roth ira",
    "should I open an IRA",
    "should I max out my HSA",
    "asset location",
    "do I have capital gains",
    "tax loss harvesting",
  ])("reads %j as accounts", (text) => {
    expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "accounts" });
  });
});

describe("accountsReply", () => {
  it("gives the order with room and reasons, where to hold what, and the gains", () => {
    const reply = accountsReply(ACCOUNT_PLAN);
    expect(reply.body).toMatch(
      /^Fill the 401\(k\) match first, then an HSA, a Roth IRA, the rest of your 401\(k\) and a taxable account\.\n1\. Your 401\(k\), up to the full match \(6% of pay\)\. You put in 4%/,
    );
    expect(reply.body).toContain("3. A Roth IRA (up to $7,500.00 a year).");
    expect(reply.body).toContain("- Pinnacle Dividend Income Fund is better in your Demo 401(k).");
    expect(reply.body).toMatch(/of losses not yet taxed\.$/);
    expect(reply.refs).toEqual({ advice: true });
  });

  it("gives real accounts the gains only, and asks for the profile first", () => {
    const real = accountsReply({ ...ACCOUNT_PLAN, advice: false });
    expect(real.body).toMatch(
      /not yet taxed\. I don't recommend an account order on real accounts yet\.$/,
    );
    expect(real.refs).toEqual({});
    expect(
      accountsReply({ ...ACCOUNT_PLAN, order: null, profile: profileSummary(EMPTY_ANSWERS, ASOF) })
        .refs.investQuestion,
    ).toBe("age");
  });
});

describe("the account order message", () => {
  it("says the order once in demo advice mode, with the costliest move", () => {
    const [message] = investmentsSource
      .gather(
        {
          ...base,
          investments: demoInvestmentSnapshot({
            accountPlan: { order: ORDER, location: ACCOUNT_PLAN.location },
          }),
        },
        {} as never,
      )
      .filter((c) => c.dedupeKey.startsWith("accounts:"));
    expect(message).toMatchObject({
      dedupeKey: "accounts:match,hsa,ira,workplace,taxable:PDIFX",
      refs: { advice: true },
      priority: MESSAGE_PRIORITY.account_order,
    });
    expect(message.body).toMatch(
      /^Here's the order I'd fill your accounts in: 1\. Your 401\(k\), up to the full match \(6% of pay\); 2\. An HSA, if your health plan has a high deductible; 3\. A Roth IRA; 4\. Back to your 401\(k\), up to the limit; 5\. A taxable account for the rest\. And Pinnacle Dividend Income Fund is better held in your Demo 401\(k\): about \$[\d.]+ a year in tax where it is\.$/,
    );
    expect(
      investmentsSource
        .gather(
          {
            ...base,
            investments: demoInvestmentSnapshot({
              advice: false,
              accountPlan: { order: ORDER, location: [] },
            }),
          },
          {} as never,
        )
        .filter((c) => c.dedupeKey.startsWith("accounts:")),
    ).toEqual([]);
  });
});

describe("Claude's account_plan tool", () => {
  it("gives the order and moves in demo advice mode, and the gains to everyone", async () => {
    const options = { client: {} as PrismaClient, now: new Date("2026-10-19T12:00:00Z") };
    vi.mocked(loadAccountPlan).mockResolvedValue({ ...ACCOUNT_PLAN, advice: false });
    const real = JSON.parse((await runInvestmentTool("u", "account_plan", {}, options)).content);
    expect(real.note).toBe("The account order is for demo advice mode only.");
    expect(real.lossesNotYetTaxed).toBe("$548.87");
    vi.mocked(loadAccountPlan).mockResolvedValue(ACCOUNT_PLAN);
    const out = await runInvestmentTool("u", "account_plan", {}, options);
    const parsed = JSON.parse(out.content);
    expect(parsed.order[0].account).toBe("Your 401(k), up to the full match (6% of pay)");
    expect(parsed.topFederalRate).toBe("22%");
    expect(out.cents).toContain(ACCOUNT_PLAN.location[0].taxDragCents);
  });
});

// Spec step 136: learn.
describe("what-is questions, by rules", () => {
  it.each([
    ["what is an index fund", "index-funds"],
    ["what's an expense ratio", "fees"],
    ["how does the match work", "the-match"],
    ["explain roth vs traditional", "roth-vs-traditional"],
    ["what does rebalancing mean", "rebalancing"],
    ["what is refinancing", "refinancing"],
    ["what's a deductible", "deductibles"],
    ["what is the standard deduction", "standard-deduction"],
  ])("reads %j as learning about %s", (text, slug) => {
    expect(parseIntent(text, ASOF)).toEqual({ kind: "learn", slug });
  });

  it.each(["what's my deductible", "what are my investment fees", "what is safe to spend"])(
    "leaves %j to the other rules",
    (text) => {
      expect(parseIntent(text, ASOF).kind).not.toBe("learn");
    },
  );
});

describe("learnReply and learn links", () => {
  it("answers with the explainer's summary and first paragraph, and a link to the rest", () => {
    const reply = learnReply("index-funds");
    expect(reply.body).toMatch(/^An index fund owns every company in a market list/);
    expect(reply.actions).toEqual([
      { id: "open", label: "Read more", kind: "link", href: "/learn/index-funds" },
    ]);
    expect(reply.refs).toEqual({});
    expect(learnReply("nope").body).toMatch(/^I can explain: index funds, /);
  });

  it("puts a Learn link under Jane's investment answers", () => {
    expect(learnLink("the-match")).toEqual({
      id: "open",
      label: "Learn: the employer match",
      kind: "link",
      href: "/learn/the-match",
    });
    const reply = rebalanceReply(true, PLAN, profileSummary(FULL, ASOF));
    expect(reply.actions.map((a) => (a.kind === "link" ? a.href : a.id))).toContain(
      "/learn/rebalancing",
    );
  });

  it("gives Claude the fixed text", async () => {
    const out = await runInvestmentTool(
      "u",
      "explainer",
      { slug: "deductibles" },
      {
        client: {} as PrismaClient,
        now: new Date(),
      },
    );
    expect(JSON.parse(out.content)).toMatchObject({
      title: "Deductibles",
      page: "/learn/deductibles",
    });
  });
});

// Spec step 137: investments on autopilot.
describe("overview and autopilot questions, by rules", () => {
  it.each([
    ["how are my investments doing", "overview"],
    ["how's my portfolio looking", "overview"],
    ["investment update", "overview"],
    ["what do you do with my investments", "autopilot"],
    ["investments on autopilot", "autopilot"],
  ])("reads %j as %s", (text, topic) => {
    expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic });
  });
});

describe("the monthly note, drift and the paused nudge in Jane's messages", () => {
  const review = reviewPortfolio(demoInvestments().accounts, 3);
  const gatherAll = (over: Partial<InvestmentSnapshot>, asOf = ASOF) =>
    investmentsSource.gather(
      { ...base, asOf, investments: demoInvestmentSnapshot(over) },
      {} as never,
    );

  it("says once a month how it's going, with the orders when the mix has drifted", () => {
    const monthly = gatherAll({ review, rebalance: PLAN }).find(
      (c) => c.dedupeKey === "monthly:2026-10",
    )!;
    expect(monthly).toMatchObject({
      kind: "decision",
      refs: { advice: true, rebalanceKey: PLAN.key },
      priority: MESSAGE_PRIORITY.investment_monthly,
    });
    expect(monthly.body).toMatch(/^Your investments start October at \$96,730\.55\./);
    expect(monthly.actions.map((a) => a.id)).toEqual(["invest.rebalance", "open", "snooze"]);
    // Real accounts get the facts, never the mix or the orders.
    const real = gatherAll({ advice: false, review, rebalance: PLAN }).find(
      (c) => c.dedupeKey === "monthly:2026-10",
    )!;
    expect(real).toMatchObject({ kind: "heads_up", refs: {} });
    expect(real.body).not.toMatch(/mix|orders/);
  });

  it("brings drift up again each month while the mix stays off target", () => {
    const keys = (asOf: string) =>
      gatherAll({ review, rebalance: PLAN }, asOf)
        .map((c) => c.dedupeKey)
        .filter((k) => k.startsWith("review:"));
    expect(keys("2026-10-19")).toEqual(["review:3:rebalance:2026-10"]);
    expect(keys("2026-11-02")).toEqual(["review:3:rebalance:2026-11"]);
  });

  it("nudges once automatic investing has been paused for a month", () => {
    const plan = {
      mode: "fixed",
      amountCents: 10_000,
      accountId: "b",
      status: "paused",
      lastPaydayOn: null,
      updatedAt: new Date("2026-09-01T00:00:00Z"),
    };
    const auto = { plan, runs: [], suggestion: null, accounts: [] };
    const nudge = gatherAll({ profile: FULL, autoInvest: auto }).find((c) =>
      c.dedupeKey.startsWith("auto:paused:"),
    )!;
    expect(nudge).toMatchObject({ kind: "decision", dedupeKey: "auto:paused:2026-09-01" });
    expect(nudge.body).toMatch(
      /^Automatic investing has been paused since Sep 1\. Want me to start again/,
    );
    expect(nudge.actions[0].id).toBe("invest.auto_resume");
    const recent = { ...auto, plan: { ...plan, updatedAt: new Date("2026-10-10T00:00:00Z") } };
    expect(
      gatherAll({ profile: FULL, autoInvest: recent }).some((c) =>
        c.dedupeKey.startsWith("auto:paused:"),
      ),
    ).toBe(false);
  });
});

describe("overviewReply and autopilotReply", () => {
  it("answers how it's going with the same note", () => {
    const reply = overviewReply(demoInvestmentSnapshot({ advice: false }));
    expect(reply.body).toMatch(/^Your investments start October at \$96,730\.55\./);
    expect(overviewReply(demoInvestmentSnapshot({ accounts: [] })).actions[0]).toMatchObject({
      href: "/connect",
    });
  });

  it("says what Jane does by herself at each level, and that trades wait for a tap", () => {
    expect(autopilotReply(null).body).toMatch(
      /^Here's what I do with your investments by myself\./,
    );
    const all = autopilotReply("all").body;
    expect(all).toMatch(/^On your autopilot setting, here's what I do/);
    expect(all).toContain(
      "Buying, selling and moving money always wait for your tap, at every level.",
    );
    expect(autopilotReply("ask").body).not.toMatch(/invest every payday/);
  });
});

// Spec step 156: prices and real returns.
const RETURNS = {
  asOf: "2026-10-18",
  simulatedPrices: true,
  periods: [
    {
      key: "1m" as const,
      label: "Last month",
      from: "2026-09-18",
      to: "2026-10-18",
      startCents: 9_500_000,
      endCents: 9_673_055,
      timeWeighted: 0.0123,
      moneyWeighted: 0.011,
      benchmark: 0.009,
      paidInCents: 40_800,
      incomeCents: 3_120,
    },
    {
      key: "1y" as const,
      label: "Last 12 months",
      from: "2025-10-18",
      to: "2026-10-18",
      startCents: 9_000_000,
      endCents: 9_673_055,
      timeWeighted: 0.0712,
      moneyWeighted: 0.0688,
      benchmark: 0.0654,
      paidInCents: 489_600,
      incomeCents: 37_440,
    },
  ],
};

describe("return questions, by rules", () => {
  it.each([
    "what's my investment return",
    "how much have my investments made",
    "portfolio performance",
    "401k returns",
  ])("reads %j as returns", (text) => {
    expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "returns" });
  });

  it("leaves a store's returns to the other rules", () => {
    expect(parseIntent("what's Target's return policy", ASOF)).not.toMatchObject({
      topic: "returns",
    });
  });
});

describe("returnsReply", () => {
  it("leads with the longest period, against a similar mix, past results only", () => {
    const reply = returnsReply(RETURNS);
    expect(reply.body).toMatch(
      /^Last 12 months, what you own returned \+7\.1% \(your own money: \+6\.9%\), against \+6\.5% for a similar mix of index funds, and paid \$374\.40 in dividends and interest\.\n- Last month: \+1\.2%; your money \+1\.1%; similar mix \+0\.9%/,
    );
    expect(reply.body).toContain("they don't say what comes next");
    expect(reply.body).toContain("demo price feed's (made up)");
    expect(reply.body).not.toMatch(/\b(?:will|expect|forecast|predict)\w*/i);
  });

  it("says when there isn't enough history yet", () => {
    expect(returnsReply({ ...RETURNS, periods: [] }).body).toMatch(/^I can't work out returns yet/);
  });

  it("adds the year's return to how the investments are doing", () => {
    const reply = overviewReply(demoInvestmentSnapshot({ advice: false, returns: RETURNS }));
    expect(reply.body).toMatch(/Last 12 months, what you own returned \+7\.1%/);
  });

  it("gives Claude every figure", async () => {
    const { loadReturns } = await import("@/lib/investments/returns");
    vi.mocked(loadReturns).mockResolvedValue(RETURNS);
    const out = await runInvestmentTool(
      "u",
      "investment_returns",
      {},
      {
        client: {} as PrismaClient,
        now: new Date("2026-10-19T12:00:00Z"),
      },
    );
    expect(JSON.parse(out.content).periods[1]).toMatchObject({
      investments: "+7.1%",
      yourMoney: "+6.9%",
    });
    expect(out.cents).toEqual(expect.arrayContaining([9_673_055, 37_440, 489_600]));
  });
});

// Spec step 157: every goal invested for its timeline.
const BUCKETS = goalBuckets(
  [
    { id: "house", name: "House", targetDate: "2028-10-01", monthlyCents: 50_000 },
    { id: "retirement", name: "Retirement", targetDate: "2048-10-19", monthlyCents: 0 },
  ],
  "2026-10-19",
  3,
);

describe("goal questions, by rules", () => {
  it.each([
    "how should my house goal be invested",
    "invest for my goals",
    "glide path",
    "should I invest my savings for a house",
  ])("reads %j as goals", (text) => {
    expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "goals" });
  });
});

describe("goalBucketsReply and the goals message", () => {
  it("lists each goal's mix and why, and says who moves new money", () => {
    const reply = goalBucketsReply({ advice: true, byHerself: true, buckets: BUCKETS });
    expect(reply.body).toMatch(
      /^Each goal is invested for when you need it\.\n- House: 2 years away: kept in cash/,
    );
    expect(reply.body).toMatch(/goes to each goal by itself, near-term goals first\.$/);
    expect(reply.refs).toEqual({ advice: true });
    expect(goalBucketsReply({ advice: true, byHerself: false, buckets: BUCKETS }).body).toMatch(
      /Choose “Handle the safe stuff”/,
    );
    expect(goalBucketsReply({ advice: false, byHerself: false, buckets: null }).refs).toEqual({});
  });

  it("says once, in demo advice mode, how each goal is invested", () => {
    const messages = (advice: boolean) =>
      investmentsSource
        .gather(
          {
            ...base,
            investments: demoInvestmentSnapshot({
              advice,
              goalBuckets: { byHerself: true, buckets: BUCKETS },
            }),
          },
          {} as never,
        )
        .filter((c) => c.dedupeKey.startsWith("goals:"));
    const [message] = messages(true);
    expect(message).toMatchObject({
      dedupeKey: "goals:house:cash,retirement:invested",
      priority: MESSAGE_PRIORITY.goal_buckets,
    });
    expect(message.body).toMatch(
      /^I've given each goal its own mix, by when you need it: House \(2 years away\): cash, never stocks; Retirement \(22 years away\): \d+% stocks\./,
    );
    expect(messages(false)).toEqual([]);
  });

  it("gives Claude each goal's mix", async () => {
    const { loadGoalBuckets } = await import("@/lib/investments/goal-buckets");
    vi.mocked(loadGoalBuckets).mockResolvedValue({
      advice: true,
      byHerself: true,
      buckets: BUCKETS,
    });
    const out = await runInvestmentTool(
      "u",
      "goal_buckets",
      {},
      { client: {} as PrismaClient, now: new Date() },
    );
    expect(JSON.parse(out.content).goals[0]).toMatchObject({
      goal: "House",
      stocks: "0%",
      cash: "100%",
    });
  });
});

// Spec step 158: college savings.
describe("college questions, by rules", () => {
  it("reads the child's age and the kind of college", () => {
    expect(parseIntent("save for college for my 5 year old", ASOF)).toEqual({
      kind: "investments",
      topic: "college",
      account: null,
      childAge: 5,
    });
    expect(parseIntent("how much for a private college for my 3-year-old", ASOF)).toMatchObject({
      topic: "college",
      childAge: 3,
      collegeType: "private",
    });
    expect(parseIntent("should I open a 529", ASOF)).toMatchObject({ topic: "college" });
    expect(parseIntent("pay off my student loan", ASOF)).not.toMatchObject({ topic: "college" });
  });
});

describe("collegeReply and the college message", () => {
  const estimate = {
    childAge: 5,
    type: "public" as const,
    years: 13,
    cost: { lowCents: 15_310_343, highCents: 20_253_440 },
    monthly: { lowCents: 65_780, highCents: 106_611 },
    plans: comparePlans("NY", "single", 1_000_000, 17_000_000),
    state: "NY",
  };

  it("gives the cost and monthly amount as ranges, the best plan, and the button", () => {
    const reply = collegeReply(true, estimate, 0);
    expect(reply.body).toMatch(
      /^For a 5-year-old at a public college in your state, four years could cost about \$153,103\.43 to \$202,534\.40 when they start in 13 years\. Putting aside about \$657\.80 to \$1,066\.11 a month gets there, depending on prices and returns\. The plan that comes out ahead: Your state's direct 529 plan \(demo\), with your state's tax break of about \$[\d,.]+ a year\./,
    );
    expect(reply.body).not.toMatch(/\bwill (?:have|cost|be)\b/);
    expect(reply.actions[0]).toEqual({
      id: "college.start",
      label: "Start saving for college",
      kind: "primary",
    });
    expect(reply.refs).toEqual({
      advice: true,
      college: { childName: "your child", childAge: 5, type: "public" },
    });
  });

  it("asks for the age when it wasn't given, and never advises real accounts", () => {
    expect(collegeReply(true, null, 0).body).toMatch(/^Tell me how old your child is/);
    expect(collegeReply(false, estimate, 0).actions.map((a) => a.id)).toEqual(["open"]);
  });

  it("offers once when the tax profile has children and there's no plan", () => {
    const offers = (college: InvestmentSnapshot["college"], advice = true) =>
      investmentsSource
        .gather({ ...base, investments: demoInvestmentSnapshot({ advice, college }) }, {} as never)
        .filter((c) => c.dedupeKey === "college:offer");
    expect(offers({ children: 2, plans: 0 })[0].body).toMatch(
      /^Your tax profile has 2 children under 17\./,
    );
    expect(offers({ children: 2, plans: 1 })).toEqual([]);
    expect(offers({ children: 0, plans: 0 })).toEqual([]);
    expect(offers({ children: 1, plans: 0 }, false)).toEqual([]);
  });
});

// Spec step 159: the HSA.
const HSA_PLAN = hsaPlan({
  balanceCents: 427_180,
  cashCents: 285_000,
  contributedCents: 240_000,
  coverage: "self",
  age: 45,
});
const HSA_VIEW = {
  advice: true,
  account: { id: "h", name: "Demo HSA", balanceCents: 427_180 },
  plan: HSA_PLAN,
  coverage: "self" as const,
  receipts: [
    {
      id: "r",
      transactionId: "t",
      date: "2026-09-01",
      merchant: "CVS Pharmacy",
      amountCents: 2_340,
      status: "saved",
    },
  ],
  savedCents: 22_680,
  demo: true,
};

describe("HSA questions, by rules", () => {
  it.each(["my hsa", "health savings account", "receipts vault", "medical receipts"])(
    "reads %j as the HSA",
    (text) => {
      expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "hsa" });
    },
  );
  it("leaves which account to fill to the account order", () => {
    expect(parseIntent("should I max out my HSA", ASOF)).toMatchObject({ topic: "accounts" });
  });
});

describe("hsaReply and the HSA messages", () => {
  it("gives the facts, the room, the vault, and the invest button in demo advice mode", () => {
    const reply = hsaReply(HSA_VIEW);
    expect(reply.body).toMatch(
      /^Your HSA has \$4,271\.80: \$2,850\.00 in cash and \$1,421\.80 invested\. This year you can put in \$2,000\.00 more under the \$4,400\.00 limit\. Your receipts vault has \$226\.80/,
    );
    expect(reply.actions[0]).toEqual({
      id: "hsa.invest",
      label: "Invest $850.00",
      kind: "primary",
    });
    expect(hsaReply({ ...HSA_VIEW, advice: false }).actions.map((a) => a.id)).toEqual(["open"]);
    expect(hsaReply({ ...HSA_VIEW, account: null, plan: null }).actions[0].id).toBe("hsa.link");
  });

  it("says when receipts are saved, offers to invest the extra cash, or a demo HSA", () => {
    const gatherHsa = (hsa: InvestmentSnapshot["hsa"], advice = true) =>
      investmentsSource
        .gather({ ...base, investments: demoInvestmentSnapshot({ advice, hsa }) }, {} as never)
        .filter((c) => c.dedupeKey.startsWith("hsa:"));
    const withHsa = gatherHsa({
      account: HSA_VIEW.account,
      plan: HSA_PLAN,
      savedCents: 22_680,
      demo: true,
      receipts: 3,
    });
    expect(withHsa.map((m) => [m.kind, m.dedupeKey])).toEqual([
      ["done", "hsa:receipts:3"],
      ["decision", "hsa:invest:85000"],
    ]);
    expect(withHsa[1].body).toMatch(/the other \$850\.00 could be invested to grow untaxed\./);
    const without = gatherHsa({
      account: null,
      plan: null,
      savedCents: 22_680,
      demo: true,
      receipts: 3,
    });
    expect(without.map((m) => m.dedupeKey)).toEqual(["hsa:receipts:3", "hsa:link"]);
    // Receipts are kept for everyone; the advice isn't.
    expect(
      gatherHsa(
        { account: HSA_VIEW.account, plan: HSA_PLAN, savedCents: 1, demo: true, receipts: 1 },
        false,
      ).map((m) => m.dedupeKey),
    ).toEqual(["hsa:receipts:1"]);
  });
});

// Spec step 160: company stock.
const COMPANY_PLAN = diversifyPlan({
  quantity: 200,
  priceCents: 10_000,
  costBasisCents: 1_000_000,
  lots: [{ date: null, quantity: 200 }],
  totalInvestedCents: 10_000_000,
  today: ASOF,
  rates: { longTerm: 0.15, shortTerm: 0.22 },
});
const COMPANY = {
  company: "Acme Corp",
  concentration: concentration({
    heldCents: 2_000_000,
    unvestedCents: 1_000_000,
    totalInvestedCents: 10_000_000,
  }),
  plan: {
    ...COMPANY_PLAN,
    key: "plan-key",
    accountId: "a",
    accountName: "Demo Stock Plan",
    nextDue: ASOF,
  },
  demo: true,
};
const COMPANY_VIEW = {
  ...COMPANY,
  advice: true,
  ticker: "ACME",
  holdings: [],
  grants: [],
  rates: { longTerm: 0.15, shortTerm: 0.22, fromEstimate: false },
};

describe("company stock questions, by rules", () => {
  it.each([
    "my rsus",
    "should I sell my company stock",
    "how much employer stock do I have",
    "my espp",
    "my stock options",
    "my vesting schedule",
  ])("reads %j as company stock", (text) => {
    expect(parseIntent(text, ASOF)).toMatchObject({
      kind: "investments",
      topic: "company_stock",
    });
  });
  it("leaves the HSA and college alone", () => {
    expect(parseIntent("my hsa", ASOF)).toMatchObject({ topic: "hsa" });
    expect(parseIntent("college for my 5 year old", ASOF)).toMatchObject({ topic: "college" });
  });
});

describe("companyStockReply and the company stock message", () => {
  it("gives the share, the plan, its tax and the risk removed, with the sell button", () => {
    const reply = companyStockReply(COMPANY_VIEW, ASOF);
    expect(reply.body).toMatch(
      /^Acme Corp is \$20,000\.00, 20% of what you've invested \(27% with the \$10,000\.00 still to vest\)\. A common rule is to keep it under 10%/,
    );
    expect(reply.body).toMatch(
      /Selling about \$10,000\.00 in 4 parts brings it to 10%: the first part, now, is \$2,500\.00 with about \$187\.50 in estimated tax on the gain, then 3 more every 3 months\. A 50% drop in the stock would then cost about \$5,000\.00 instead of \$10,000\.00\./,
    );
    expect(reply.actions[0]).toEqual({
      id: "company.sell",
      label: "Sell $2,500.00 now",
      kind: "primary",
    });
    expect(reply.refs).toEqual({ advice: true, companyPlan: "plan-key" });
  });

  it("gives only the facts outside demo advice mode, and offers a demo stock plan", () => {
    const facts = companyStockReply({ ...COMPANY_VIEW, advice: false }, ASOF);
    expect(facts.body).not.toMatch(/Selling|rule/);
    expect(facts.actions.map((a) => a.id)).toEqual(["open"]);
    expect(facts.refs).toEqual({});
    const none = companyStockReply({ ...COMPANY_VIEW, company: null, plan: null }, ASOF);
    expect(none.actions[0].id).toBe("company.link");
  });

  it("waits for the tap until the next part is due", () => {
    const later = { ...COMPANY_VIEW.plan, parts: COMPANY_VIEW.plan.parts.slice(1) };
    const reply = companyStockReply({ ...COMPANY_VIEW, plan: later }, ASOF);
    expect(reply.body).toMatch(/the next part, on Jan 19, 2027, is \$2,500\.00/);
    expect(reply.actions.map((a) => a.id)).toEqual(["open"]);
  });

  it("posts the plan when a part is due, a heads-up when it can't be sold, nothing otherwise", () => {
    const gatherCompany = (companyStock: InvestmentSnapshot["companyStock"], advice = true) =>
      investmentsSource
        .gather(
          { ...base, investments: demoInvestmentSnapshot({ advice, companyStock }) },
          {} as never,
        )
        .filter((c) => c.dedupeKey.startsWith("company:"));
    const due = gatherCompany(COMPANY);
    expect(due.map((m) => [m.kind, m.dedupeKey, m.refs])).toEqual([
      ["decision", "company:sell:plan-key", { advice: true, companyPlan: "plan-key" }],
    ]);
    expect(due[0].actions.map((a) => a.id)).toEqual(["company.sell", "open", "snooze"]);
    expect(due[0].priority).toBe(MESSAGE_PRIORITY.company_stock);
    const later = { ...COMPANY.plan, parts: COMPANY.plan.parts.slice(1) };
    expect(gatherCompany({ ...COMPANY, plan: later })).toEqual([]);
    expect(gatherCompany({ ...COMPANY, plan: null }).map((m) => m.dedupeKey)).toEqual([
      "company:over",
    ]);
    expect(gatherCompany(COMPANY, false)).toEqual([]);
    // The demo bank's own 38 shares are under the limit.
    expect(gatherCompany(demoInvestmentSnapshot().companyStock)).toEqual([]);
  });
});

// Spec step 161: crypto, read-only.
const CRYPTO_SIZE = cryptoSize(
  [
    { valueCents: 822_993, costBasisCents: 693_000 },
    { valueCents: 104_400, costBasisCents: 76_000 },
  ],
  9_673_055,
);
const CRYPTO_FEES = cryptoFees(2_688, 180_000);
const READ = new Date("2026-10-18T15:00:00Z");
const CRYPTO_VIEW = {
  advice: true,
  demo: true,
  connections: [
    {
      id: "x",
      kind: "exchange" as const,
      name: "Demo Exchange",
      address: null,
      source: "Demo Exchange (demo, sample data), read-only",
      asOf: READ,
      stale: false,
      totalCents: 822_993,
      fees: CRYPTO_FEES,
    },
    {
      id: "w",
      kind: "wallet" as const,
      name: "Demo Wallet",
      address: "0xDEMO",
      source: "Demo Wallet (demo, sample data), read-only",
      asOf: READ,
      stale: false,
      totalCents: 104_400,
      fees: null,
    },
  ],
  holdings: [],
  size: CRYPTO_SIZE,
  fees: CRYPTO_FEES,
};

describe("crypto buying questions are decisions, not a connect offer", () => {
  it("answers 'should I buy btc' as an investing decision", () => {
    expect(parseIntent("should I buy btc", ASOF)).toMatchObject({
      kind: "investments",
      topic: "decision",
      decision: { kind: "buy_crypto" },
    });
  });
});

describe("crypto questions, by rules", () => {
  it.each(["my crypto", "how much bitcoin do I have", "my ethereum"])(
    "reads %j as crypto",
    (text) => {
      expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "crypto" });
    },
  );
});

describe("cryptoReply and the crypto messages", () => {
  it("gives the size with its sources and time, the flags, and never trades", () => {
    const reply = cryptoReply(CRYPTO_VIEW);
    expect(reply.body).toMatch(
      /^Your crypto is \$9,273\.93, 8\.7% of everything you've invested, from Demo Exchange and Demo Wallet \(read-only\)\. As of Oct 18, 3:00 PM UTC\./,
    );
    expect(reply.body).toMatch(/above the 5% a common rule of thumb/);
    expect(reply.body).toMatch(
      /fees came to \$26\.88 on \$1,800\.00 of trades this past year \(1\.49%\)/,
    );
    expect(reply.body).toMatch(/I never buy, sell or move crypto\.$/);
    expect(reply.actions.map((a) => a.id)).toEqual(["open"]);
    expect(reply.refs).toEqual({ advice: true });
  });

  it("gives only the facts outside demo advice mode, and offers a demo exchange when empty", () => {
    const facts = cryptoReply({ ...CRYPTO_VIEW, advice: false });
    expect(facts.body).not.toMatch(/rule of thumb|fees came/);
    expect(facts.refs).toEqual({});
    const none = cryptoReply({ ...CRYPTO_VIEW, connections: [] });
    expect(none.actions[0]).toMatchObject({ id: "crypto.link", kind: "primary" });
  });

  it("says once it can see crypto, and flags share and fees in demo advice mode", () => {
    const gatherCrypto = (crypto: InvestmentSnapshot["crypto"], advice = true) =>
      investmentsSource
        .gather({ ...base, investments: demoInvestmentSnapshot({ advice, crypto }) }, {} as never)
        .filter((c) => c.dedupeKey.startsWith("crypto:"));
    const all = {
      size: CRYPTO_SIZE,
      fees: CRYPTO_FEES,
      demo: true,
      sources: ["Demo Exchange", "Demo Wallet"],
    };
    const messages = gatherCrypto(all);
    expect(messages.map((m) => [m.kind, m.dedupeKey])).toEqual([
      ["done", "crypto:seen"],
      ["heads_up", "crypto:share"],
      ["heads_up", "crypto:fees"],
    ]);
    expect(messages[0].body).toMatch(/It now counts in your net worth\. I only read it/);
    // No message ever carries a button that would trade.
    expect(messages.flatMap((m) => m.actions.map((a) => a.id))).toEqual(
      expect.not.arrayContaining(["crypto.link", "invest.rebalance"]),
    );
    expect(gatherCrypto(all, false).map((m) => m.dedupeKey)).toEqual(["crypto:seen"]);
    expect(gatherCrypto(demoInvestmentSnapshot().crypto)).toEqual([]);
  });
});

// Spec step 162: cash done right.
const CASH_PLACES = [
  {
    id: "chk",
    name: "Demo Checking",
    kind: "checking" as const,
    balanceCents: 384_012,
    rateBps: 7,
  },
  {
    id: "sav",
    name: "Demo Savings",
    kind: "savings" as const,
    balanceCents: 2_431_000,
    rateBps: 39,
  },
  {
    id: "brk",
    name: "Demo Brokerage cash",
    kind: "sweep" as const,
    balanceCents: 81_357,
    rateBps: 50,
  },
];
const CASH_PLAN = {
  ...cashPlan({
    places: CASH_PLACES,
    monthlySpendingCents: 300_000,
    emergencyTargetCents: 900_000,
  }),
  key: "cash-key",
};
const CASH_VIEW = {
  advice: true,
  places: CASH_PLACES,
  monthlySpendingCents: 300_000,
  emergencyTargetCents: 900_000,
  emergencyFromGoal: false,
  plan: CASH_PLAN,
};

describe("cash questions, by rules", () => {
  it.each([
    "where should i keep my cash",
    "should I open a high yield savings account",
    "money market",
    "treasury ladder",
    "are t-bills worth it",
    "is my savings earning enough",
  ])("reads %j as cash", (text) => {
    expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "cash" });
  });
});

describe("cashReply and the cash message", () => {
  it("gives the plan with what it earns, the emergency fund in reach, and a tap per move", () => {
    const reply = cashReply(CASH_VIEW);
    expect(reply.body).toBe(
      "Your cash is $28,963.69 and earns about $101.57 a year. Keeping $3,000.00 in checking, the $9,000.00 emergency fund in high-yield savings (in reach within 3 days) and the other $16,963.69 in a money market fund would earn about $1,074.57: $973.00 more a year at stand-in rates.",
    );
    expect(reply.actions.map((a) => [a.id, a.label])).toEqual([
      ["cash.to_savings", "Move $840.12 to savings"],
      ["cash.to_money_market", "Put $813.57 in a money market fund"],
      ["open", "See your cash"],
    ]);
    expect(reply.refs).toEqual({ advice: true, cashPlan: "cash-key" });
  });

  it("gives only the facts outside demo advice mode", () => {
    const reply = cashReply({ ...CASH_VIEW, advice: false });
    expect(reply.body).toMatch(/^Your cash: \$3,840\.12 in Demo Checking, /);
    expect(reply.actions.map((a) => a.id)).toEqual(["open"]);
    expect(reply.refs).toEqual({});
  });

  it("posts the plan with its taps when it earns enough more, once per plan", () => {
    const gatherCash = (plan: InvestmentSnapshot["cash"]["plan"], advice = true) =>
      investmentsSource
        .gather(
          { ...base, investments: demoInvestmentSnapshot({ advice, cash: { plan } }) },
          {} as never,
        )
        .filter((c) => c.dedupeKey.startsWith("cash:"));
    const [message] = gatherCash(CASH_PLAN);
    expect(message).toMatchObject({
      kind: "decision",
      dedupeKey: "cash:cash-key",
      refs: { advice: true, cashPlan: "cash-key" },
      priority: MESSAGE_PRIORITY.cash,
    });
    expect(message.body).toMatch(/nothing moves until you say so\.$/);
    expect(gatherCash({ ...CASH_PLAN, moves: [] })[0]).toMatchObject({
      kind: "heads_up",
      refs: { advice: true },
    });
    expect(gatherCash({ ...CASH_PLAN, gainCents: 4_999 })).toEqual([]);
    expect(gatherCash(CASH_PLAN, false)).toEqual([]);
  });
});

// Spec step 163: a steady hand.
const STEADY_DROP = { key: "1m", windowLabel: "the last month", rate: -0.1 };
const dropPeriods = (r: number) => [
  {
    key: "1m" as const,
    label: "Last month",
    from: "",
    to: "",
    startCents: 0,
    endCents: 0,
    timeWeighted: r,
    moneyWeighted: null,
    benchmark: null,
    paidInCents: 0,
    incomeCents: 0,
  },
];

describe("steady hand questions, by rules", () => {
  it.each([
    "should I sell everything",
    "the market is crashing",
    "why are my investments down",
    "I want to get out of the market",
  ])("reads %j as a steady-hand question", (text) => {
    expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "steady" });
  });
});

describe("steadyReply and the drop message", () => {
  it("answers with what changed, the goals' timelines and the plan, never a prediction", () => {
    const reply = steadyReply({ advice: true, drop: STEADY_DROP, buckets: [] });
    expect(reply.body).toMatch(/^Your investments are down 10\.0% over the last month/);
    expect(reply.body).toMatch(/I can't tell you what markets will do/);
    expect(reply.refs).toEqual({ advice: true });
    expect(steadyReply({ advice: true, drop: null, buckets: [] }).body).toMatch(
      /haven't had a big drop lately/,
    );
    expect(steadyReply({ advice: false, drop: STEADY_DROP, buckets: [] }).body).toMatch(
      /don't give recommendations on real accounts/,
    );
  });

  it("posts one calm message per month while a drop is on, in demo advice mode only", () => {
    const gatherSteady = (r: number, advice = true) =>
      investmentsSource
        .gather(
          {
            ...base,
            investments: demoInvestmentSnapshot({
              advice,
              returns: { asOf: ASOF, simulatedPrices: true, periods: dropPeriods(r) },
            }),
          },
          {} as never,
        )
        .filter((c) => c.dedupeKey.startsWith("steady:"));
    const [m] = gatherSteady(-0.1);
    expect(m).toMatchObject({
      kind: "heads_up",
      dedupeKey: "steady:1m:2026-10",
      priority: MESSAGE_PRIORITY.steady_hand,
    });
    expect(m.actions.map((a) => a.id)).toEqual(["open", "snooze"]);
    expect(gatherSteady(-0.05)).toEqual([]);
    expect(gatherSteady(-0.1, false)).toEqual([]);
  });
});

// Spec step 210: retirement accounts used fully.
const RA_VIEW = {
  advice: true,
  age: 45,
  limits: [
    {
      key: "workplace" as const,
      label: "401(k), 403(b) or 457 at work",
      limitCents: 2_450_000,
      catchUpCents: 0,
      usedCents: 1_632_000,
      roomCents: 818_000,
    },
    {
      key: "ira" as const,
      label: "IRAs (traditional and Roth together)",
      limitCents: 750_000,
      catchUpCents: 0,
      usedCents: 200_000,
      roomCents: 550_000,
    },
  ],
  match: {
    employeeRate: 0.04,
    fullMatchRate: 0.06,
    missedCents: 81_600,
    extraEmployeeCents: 163_200,
    matchRate: 0.5,
  },
  roth: {
    choice: "roth" as const,
    marginalRate: 0.12,
    fromEstimate: true,
    access: { kind: "direct" as const, allowedShare: 1 as const },
    magiCents: 8_000_000,
  },
  ira: { id: "ira", name: "Demo Roth IRA", roth: true },
  iraAllowedCents: 550_000,
  demo: true,
  pending: null,
};

describe("retirement accounts questions, by rules", () => {
  it.each([
    "what is a backdoor roth",
    "what are the contribution limits",
    "am I getting the full match",
    "how much can I put in my IRA",
  ])("reads %j as retirement accounts", (text) => {
    expect(parseIntent(text, ASOF)).toMatchObject({
      kind: "investments",
      topic: "retirement_accounts",
    });
  });
});

describe("retirementAccountsReply and the retirement messages", () => {
  it("gives the limits, the missed match in dollars, Roth by bracket and a tap for each", () => {
    const reply = retirementAccountsReply(RA_VIEW);
    expect(reply.body).toMatch(
      /^This year: 401\(k\), 403\(b\) or 457 at work: \$16,320\.00 of \$24,500\.00 \(\$8,180\.00 left\)/,
    );
    expect(reply.body).toMatch(/leaving about \$816\.00 a year of their money on the table/);
    expect(reply.body).toMatch(/Roth usually wins at your bracket/);
    expect(reply.actions.map((a) => a.id)).toEqual(["retire.match", "retire.ira", "open"]);
    expect(reply.refs).toEqual({ advice: true, iraCents: 550_000 });
  });
  it("explains the backdoor Roth without a button for it, and only facts outside demo advice", () => {
    const backdoor = retirementAccountsReply({
      ...RA_VIEW,
      roth: {
        ...RA_VIEW.roth,
        access: { kind: "backdoor", allowedShare: 0, steps: ["a", "b", "c"], note: "pro-rata" },
      },
    });
    expect(backdoor.body).toMatch(
      /The backdoor route: a b c pro-rata I don't do this one for you\./,
    );
    expect(backdoor.actions.map((a) => a.id)).toEqual(["retire.match", "open"]);
    const facts = retirementAccountsReply({ ...RA_VIEW, advice: false });
    expect(facts.body).not.toMatch(/employer|bracket|backdoor/);
    expect(facts.actions.map((a) => a.id)).toEqual(["open"]);
  });
  it("posts the missed match and the IRA room, each with its tap", () => {
    const gather = (retirementAccounts: InvestmentSnapshot["retirementAccounts"], advice = true) =>
      investmentsSource
        .gather(
          { ...base, investments: demoInvestmentSnapshot({ advice, retirementAccounts }) },
          {} as never,
        )
        .filter((c) => c.dedupeKey.startsWith("retire:"));
    const messages = gather(RA_VIEW);
    expect(messages.map((m) => [m.kind, m.dedupeKey])).toEqual([
      ["decision", "retire:match:816"],
      ["decision", "retire:ira:2026"],
    ]);
    expect(messages[1].refs).toEqual({ advice: true, iraCents: 550_000 });
    expect(gather(RA_VIEW, false)).toEqual([]);
    expect(gather({ ...RA_VIEW, match: { ...RA_VIEW.match, missedCents: 0 }, ira: null })).toEqual(
      [],
    );
  });
});

// Spec step 211: old accounts brought home.
const OLD_ASKED = {
  id: "p1",
  employer: "Globex Industries",
  status: "asked",
  planName: null,
  balanceCents: null,
  fees: null,
  steps: [],
  arrivesOn: null,
};
const OLD_FOUND = {
  ...OLD_ASKED,
  status: "found",
  planName: "Globex Industries 401(k) Plan",
  balanceCents: 3_820_000,
  fees: { beforeCents: 42_784, afterCents: 1_146, savedCents: 41_638 },
};

describe("old account questions, by rules", () => {
  it.each([
    "my old 401k",
    "I left a 401k at my last job",
    "how do I roll over my 401k",
    "forgotten 401k",
    "rollover",
  ])("reads %j as old accounts", (text) => {
    expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "old_accounts" });
  });
});

describe("the old account question, the found plan and the rollover", () => {
  it("asks once per employer with Yes and No, then offers the rollover with fees compared", () => {
    const gather = (plans: unknown[], advice = true) =>
      investmentsSource
        .gather(
          {
            ...base,
            investments: demoInvestmentSnapshot({
              advice,
              oldAccounts: { advice, plans: plans as never, demo: true },
            }),
          },
          {} as never,
        )
        .filter((c) => c.dedupeKey.startsWith("oldplan:"));
    const [ask] = gather([OLD_ASKED]);
    expect(ask.body).toMatch(/^Did you have a 401\(k\) at Globex Industries\?/);
    expect(ask.actions.map((a) => a.id)).toEqual(["oldplan.yes", "oldplan.no", "open", "snooze"]);
    expect(ask.refs).toEqual({ oldPlanId: "p1" });
    const [roll] = gather([OLD_FOUND]);
    expect(roll.body).toMatch(
      /It costs about \$427\.84 a year in fees; in a low-cost index fund the same money would cost about \$11\.46, \$416\.38 a year less\./,
    );
    expect(roll.body).toMatch(/isn't a withdrawal and isn't taxed/);
    expect(roll.actions[0]).toMatchObject({ id: "oldplan.rollover", label: "Roll it over" });
    expect(gather([OLD_FOUND], false)).toEqual([]);
  });
  it("answers where each plan stands", () => {
    const reply = oldAccountsReply({ advice: true, plans: [OLD_FOUND] as never, demo: true });
    expect(reply.body).toMatch(
      /^Globex Industries \(\$38,200\.00\): found, read-only, ready to roll over\./,
    );
    expect(reply.actions[0].id).toBe("oldplan.rollover");
    expect(
      oldAccountsReply({ advice: false, plans: [OLD_FOUND] as never, demo: true }).actions.map(
        (a) => a.id,
      ),
    ).toEqual(["open"]);
  });
});

// Spec step 212: income in retirement.
const RI_VIEW = {
  advice: true,
  age: 58,
  applies: true,
  retireAge: 65,
  balances: { taxableCents: 10_000_000, preTaxCents: 60_000_000, rothCents: 10_000_000 },
  ss: {
    fullMonthlyCents: 300_000,
    source: "statement" as const,
    options: [
      { age: 62, monthlyCents: 210_000, lifetimeToAgeCents: 57_960_000 },
      { age: 67, monthlyCents: 300_000, lifetimeToAgeCents: 64_800_000 },
      { age: 70, monthlyCents: 372_000, lifetimeToAgeCents: 66_960_000 },
    ],
    breakeven62to67: 78.7,
    breakeven67to70: 82.5,
    startAge: 67,
  },
  rmd: { startAge: 75, birthYear: 1968, firstYearCents: 2_439_024 },
  draw: [
    {
      key: "taxableCents" as const,
      label: "Taxable accounts first: only the gains are taxed",
      cents: 10_000_000,
    },
    {
      key: "preTaxCents" as const,
      label: "Then pre-tax accounts (401(k), traditional IRA): taxed as income",
      cents: 60_000_000,
    },
  ],
  spendMonthlyCents: 500_000,
  spendFrom: "you" as const,
  taxRate: 0.12,
  paycheck: {
    sustainableMonthly: { lowCents: 480_000, highCents: 640_000 },
    lasts: { lowAge: 93, highAge: 95 },
    lastsToPlan: false,
  },
  inputs: { ssMonthlyCents: 300_000, retireAge: 65, ssStartAge: null, spendMonthlyCents: 500_000 },
};

describe("retirement income questions, by rules", () => {
  it.each([
    "when should I claim social security",
    "what is an RMD",
    "how long will my money last",
    "my retirement paycheck",
    "which accounts should I draw from first",
  ])("reads %j as retirement income", (text) => {
    expect(parseIntent(text, ASOF)).toMatchObject({
      kind: "investments",
      topic: "retirement_income",
    });
  });
});

describe("retirementIncomeReply and the retirement income message", () => {
  it("gives the paycheck with how long it lasts, Social Security at 62, 67 and 70, the minimums, the order", () => {
    const reply = retirementIncomeReply(RI_VIEW);
    expect(reply.body).toMatch(
      /^Spending \$5,000\.00 a month from 65, your money would last to about age 93 to 95 \(the plan runs to 95\)\./,
    );
    expect(reply.body).toMatch(/\$4,800\.00 to \$6,400\.00 a month before tax/);
    expect(reply.body).toMatch(
      /\$2,100\.00 a month if you start at 62, \$3,000\.00 at 67, \$3,720\.00 at 70 \(from your statement\)/,
    );
    expect(reply.body).toMatch(
      /Required minimum distributions start at 75; on today's pre-tax balance the first year's minimum would be about \$24,390\.24/,
    );
    expect(reply.body).toMatch(
      /The order to draw: 1\. taxable accounts first, 2\. then pre-tax accounts \(401\(k\)/,
    );
    expect(reply.refs).toEqual({ advice: true });
  });
  it("gives only Social Security and minimum facts outside demo advice mode", () => {
    const reply = retirementIncomeReply({ ...RI_VIEW, advice: false });
    expect(reply.body).not.toMatch(/Spending|order to draw/);
    expect(reply.body).toMatch(/I don't give recommendations on real accounts yet\.$/);
  });
  it("posts one message a year from 15 years out, in demo advice mode only", () => {
    const gather = (retirementIncome: InvestmentSnapshot["retirementIncome"], advice = true) =>
      investmentsSource
        .gather(
          { ...base, investments: demoInvestmentSnapshot({ advice, retirementIncome }) },
          {} as never,
        )
        .filter((c) => c.dedupeKey.startsWith("retire:income:"));
    expect(gather(RI_VIEW).map((m) => m.dedupeKey)).toEqual(["retire:income:2026"]);
    expect(gather({ ...RI_VIEW, applies: false })).toEqual([]);
    expect(gather(RI_VIEW, false)).toEqual([]);
  });
});

// Spec step 213: investing for the family.
const FAMILY_VIEW = {
  advice: true,
  demo: true,
  children: [
    {
      id: "c1",
      name: "Sam",
      age: 15,
      earnedCents: 300_000,
      custodial: {
        accountId: "a1",
        name: "Demo Custodial Account (child's)",
        balanceCents: 120_000,
      },
      roth: {
        accountId: "a2",
        name: "Demo Child Roth IRA",
        usedCents: 100_000,
        roomCents: 200_000,
      },
      college: {
        planId: "p1",
        goalName: "College for Sam",
        targetCents: 15_000_000,
        savedCents: 3_000_000,
        percent: 20,
      },
      gift: null,
    },
  ],
};

describe("family questions, by rules", () => {
  it.each([
    "a custodial account for my kid",
    "what is a UTMA",
    "can grandparents gift to a 529",
    "the kiddie tax",
    "roth ira for my teenager",
  ])("reads %j as family investing", (text) => {
    expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "family" });
  });
});

describe("familyReply and the family messages", () => {
  it("says where each child stands, and never puts a gift link in a reply", () => {
    const reply = familyReply(FAMILY_VIEW);
    expect(reply.body).toMatch(
      /^Sam: custodial account \$1,200\.00; Roth IRA with \$2,000\.00 of room this year; college fund 20% funded\./,
    );
    expect(reply.body).toMatch(/can't be taken back/);
    expect(reply.body).not.toMatch(/\/gift\//);
    expect(familyReply({ ...FAMILY_VIEW, advice: false }).body).toMatch(
      /don't give recommendations on real accounts/,
    );
  });
  it("offers a gift link and a Roth for a child who earns, each a tap, in demo advice mode", () => {
    const gather = (family: InvestmentSnapshot["family"], advice = true) =>
      investmentsSource
        .gather({ ...base, investments: demoInvestmentSnapshot({ advice, family }) }, {} as never)
        .filter((c) => c.dedupeKey.startsWith("family:"));
    const messages = gather(FAMILY_VIEW);
    expect(messages.map((m) => m.dedupeKey)).toEqual(["family:gift:p1", "family:roth:c1:2026"]);
    expect(messages[0].body).toMatch(
      /shows only the goal and how far along it is, never your money/,
    );
    expect(messages[0].actions[0].id).toBe("family.gift_link");
    expect(messages[1].refs).toEqual({ advice: true, familyChild: "c1", iraCents: 200_000 });
    expect(gather(FAMILY_VIEW, false)).toEqual([]);
    // With a link already made, only the Roth is offered.
    const withLink = {
      ...FAMILY_VIEW,
      children: [{ ...FAMILY_VIEW.children[0], gift: { token: "t", gifts: [] } }],
    };
    expect(gather(withLink).map((m) => m.dedupeKey)).toEqual(["family:roth:c1:2026"]);
  });
});

// Spec step 214: property as an investment.
const PROP_VIEW = {
  advice: true,
  demo: true,
  year: 2026,
  homes: [
    {
      id: "h",
      name: "Home",
      valueCents: 45_000_000,
      valuedOn: "2026-09-01",
      loanCents: 31_240_000,
      equityCents: 13_760_000,
      rateBps: 625,
      paymentCents: 214_000,
    },
  ],
  rentals: [
    {
      id: "r1",
      name: "Maple St rental",
      figures: {
        rentCents: 2_220_000,
        mortgagePaidCents: 1_344_000,
        mortgageInterestCents: 1_130_000,
        principalCents: 214_000,
        propertyTaxCents: 230_000,
        otherExpensesCents: 150_000,
        cashFlowCents: 496_000,
        profitCents: 710_000,
        depreciationCents: 756_288,
        taxableCents: -46_288,
        cashOnCash: 0.0763,
        returnWithPrincipal: 0.1092,
      },
      counts: { rent: 12, mortgage: 12, tax: 2, other: 3 },
      depreciationYear: 2026,
      cashInvestedCents: 6_500_000,
      loanBalanceCents: 18_200_000,
      source: "demo",
    },
  ],
  paydown: {
    extraMonthlyCents: 50_000,
    years: 10,
    paydown: { interestSavedCents: 2_100_000 },
    invest: { lowGainCents: 1_300_000, highGainCents: 3_000_000 },
    verdict: "close" as const,
    homeName: "Home",
    rateBps: 625,
  },
};

describe("property questions, by rules", () => {
  it.each(["my rental", "my investment property", "my home equity", "cash on cash return"])(
    "reads %j as property",
    (text) => {
      expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "property" });
    },
  );
});

describe("propertyReply and the property messages", () => {
  it("gives equity, the rental from its own deposits, and both sides of paying down", () => {
    const reply = propertyReply(PROP_VIEW);
    expect(reply.body).toMatch(
      /^Home is worth \$450,000\.00 \(your value\) and you owe \$312,400\.00, so your equity is \$137,600\.00\./,
    );
    expect(reply.body).toMatch(
      /Maple St rental, last 12 months: rent \$22,200\.00 from 12 deposits, cash flow \$4,960\.00 \(7\.6% on the \$65,000\.00 you put in\), taxable profit -\$462\.88 after \$7,562\.88 of depreciation\./,
    );
    expect(reply.body).toMatch(
      /saves about \$21,000\.00 in interest for certain; investing it could grow by about \$13,000\.00 to \$30,000\.00, with no guarantee\./,
    );
    expect(reply.refs).toEqual({ advice: true });
    const facts = propertyReply({ ...PROP_VIEW, advice: false });
    expect(facts.body).not.toMatch(/no guarantee/);
  });
  it("posts each rental's year and the paydown question once a year, in demo advice mode only", () => {
    const gather = (property: InvestmentSnapshot["property"], advice = true) =>
      investmentsSource
        .gather({ ...base, investments: demoInvestmentSnapshot({ advice, property }) }, {} as never)
        .filter((c) => c.dedupeKey.startsWith("property:"));
    expect(gather(PROP_VIEW).map((m) => m.dedupeKey)).toEqual([
      "property:rental:r1:2026",
      "property:paydown:2026",
    ]);
    expect(gather(PROP_VIEW, false)).toEqual([]);
  });
});

// Spec step 215: what costly products really cost.
const SCHED = [7, 6, 5, 4, 3, 2, 1];
const ANNUITY = {
  id: "a1",
  kind: "annuity" as const,
  name: "Lifetrust variable annuity",
  provider: "Lifetrust Insurance",
  status: "active",
  source: "demo",
  valueCents: 8_500_000,
  yearlyCostCents: 216_750,
  feeBps: 255,
  gap: feeGap(8_500_000, 255),
  surrender: {
    pctNow: 4,
    cents: 340_000,
    endsOn: "2030-10-01",
    byYear: surrenderByYear(8_500_000, SCHED, 4),
  },
  exit: exitComparison({
    valueCents: 8_500_000,
    feeBps: 255,
    schedule: SCHED,
    purchasedOn: "2023-10-01",
    today: "2026-10-18",
  }),
  wholeLife: null,
  note: "Gains taken out of an annuity are taxed as ordinary income.",
  premiumYearlyCents: 0,
};
const WHOLE = {
  ...ANNUITY,
  id: "w1",
  kind: "whole_life" as const,
  name: "Whole life policy",
  valueCents: 2_840_000,
  yearlyCostCents: 600_000,
  feeBps: null,
  gap: null,
  exit: null,
  wholeLife: wholeLifeCompare({
    premiumYearlyCents: 600_000,
    years: 6,
    cashValueCents: 2_840_000,
    surrenderPctNow: 5,
  }),
  premiumYearlyCents: 600_000,
};
const COSTLY_VIEW = {
  advice: true,
  demo: true,
  products: [ANNUITY, WHOLE],
  asked: [],
  advisory: null,
};

describe("costly product questions, by rules", () => {
  it.each([
    "what does my annuity really cost",
    "what is a surrender charge",
    "is whole life worth it",
    "my advisory fees",
  ])("reads %j as costly products", (text) => {
    expect(parseIntent(text, ASOF)).toMatchObject({
      kind: "investments",
      topic: "costly_products",
    });
  });
});

describe("costlyReply and the costly product messages", () => {
  it("gives the yearly cost in dollars with the surrender charge and when it ends", () => {
    const reply = costlyReply(COSTLY_VIEW);
    expect(reply.body).toMatch(/costs about \$2,167\.50 a year \(2\.55% of \$85,000\.00\)\./);
    expect(reply.body).toMatch(
      /Leaving now would carry a 4% surrender charge \(\$3,400\.00\), which reaches zero on Oct 1, 2030\./,
    );
    expect(reply.body).toMatch(
      /Whole life policy takes \$6,000\.00 a year in premiums, and its cash value is \$28,400\.00/,
    );
    expect(reply.refs).toEqual({ advice: true });
  });
  it("never says to leave without the surrender figures, and recommends nothing on real accounts", () => {
    for (const p of [ANNUITY, WHOLE]) {
      const line = productLine(p);
      if (/\b(leav\w+|leave|exit|get out|surrender)\b/i.test(line)) {
        expect(line).toMatch(/surrender charge/);
        expect(line).toMatch(/reaches zero on/);
      }
      expect(line).not.toMatch(/\b(cancel|you should (?:leave|sell|surrender))\b/i);
    }
    const real = costlyReply({ ...COSTLY_VIEW, advice: false });
    expect(real.body).toMatch(/I don't give recommendations on real accounts yet\.$/);
    expect(real.body).not.toMatch(/leav|surrender|low-cost fund/i);
    expect(real.refs).toEqual({});
  });
  it("asks about a premium once, and posts each costly product once a year, in demo advice mode", () => {
    const gather = (costly: InvestmentSnapshot["costly"], advice = true) =>
      investmentsSource
        .gather({ ...base, investments: demoInvestmentSnapshot({ advice, costly }) }, {} as never)
        .filter((c) => c.dedupeKey.startsWith("costly:"));
    const asked = gather({
      ...COSTLY_VIEW,
      products: [],
      asked: [{ id: "q1", provider: "NORTHWESTERN MUTUAL", yearlyCents: 600_000 }],
    });
    expect(asked[0].actions.map((a) => a.id)).toEqual([
      "costly.yes",
      "costly.no",
      "open",
      "snooze",
    ]);
    expect(asked[0].refs).toEqual({ productId: "q1" });
    expect(gather(COSTLY_VIEW).map((m) => m.dedupeKey)).toEqual([
      "costly:product:a1:2026",
      "costly:product:w1:2026",
    ]);
    // No message carries a button that leaves or cancels anything.
    expect(gather(COSTLY_VIEW).flatMap((m) => m.actions.map((a) => a.id))).toEqual([
      "open",
      "snooze",
      "open",
      "snooze",
    ]);
    expect(gather(COSTLY_VIEW, false)).toEqual([]);
  });
});

// Spec step 216: the yearly investing review.
const REVIEW_SNAP = (over: Partial<InvestmentSnapshot> = {}) =>
  demoInvestmentSnapshot({
    advice: true,
    profile: {
      age: 45,
      ageOn: "2026-10-01",
      horizon: "over_20",
      dropReaction: "worry",
      goals: ["retirement"],
      answeredAt: new Date("2026-10-01"),
      updatedAt: new Date("2026-10-01"),
    } as never,
    retirementAccounts: RA_VIEW,
    oldAccounts: { advice: true, demo: true, plans: [OLD_FOUND as never] },
    automatic: {
      did: [{ what: "Invested $250.00 of new cash", cents: 25_000, createdAt: new Date() }],
      asked: [],
    },
    review2: {
      harvest: [],
      harvestKey: null,
      goals: [{ name: "House", percent: 62, monthlyCents: 85_000, monthsLeft: 14 }],
      raise: false,
    },
    ...over,
  });

describe("the yearly review", () => {
  it("is one message with every item's button, once a year", () => {
    const messages = investmentsSource
      .gather({ ...base, investments: REVIEW_SNAP() }, {} as never)
      .filter((c) => c.dedupeKey.startsWith("review:"));
    expect(messages).toHaveLength(1);
    const m = messages[0];
    expect(m.dedupeKey).toBe("review:2026");
    expect(m.kind).toBe("decision");
    expect(m.actions.map((a) => a.id)).toEqual([
      "retire.ira",
      "retire.match",
      "oldplan.rollover",
      "open",
      "snooze",
    ]);
    expect(m.body).toMatch(/^Your 2026 investing review, all in one place:/);
    expect(m.body).toMatch(/Done: What I did within your caps: Invested \$250\.00 of new cash\./);
    expect(m.body).toMatch(/Nothing moves until you tap/);
    expect(m.refs).toMatchObject({ advice: true, iraCents: 550_000, oldPlanId: "p1" });
  });
  it("comes after a raise as its own message, and only in demo advice mode", () => {
    const raise = investmentsSource
      .gather(
        {
          ...base,
          investments: REVIEW_SNAP({
            review2: { harvest: [], harvestKey: null, goals: [], raise: true },
          }),
        },
        {} as never,
      )
      .find((c) => c.dedupeKey.startsWith("review:"))!;
    expect(raise.dedupeKey).toBe("review:raise:2026-10");
    expect(raise.body).toMatch(/Congratulations on the raise/);
    expect(
      investmentsSource
        .gather({ ...base, investments: REVIEW_SNAP({ advice: false }) }, {} as never)
        .filter((c) => c.dedupeKey.startsWith("review:")),
    ).toEqual([]);
  });
  it("answers on request with the same list, and gathering it moves nothing", () => {
    expect(parseIntent("do my yearly investing review", ASOF)).toMatchObject({
      kind: "investments",
      topic: "yearly_review",
    });
    const reply = yearlyReviewReply(REVIEW_SNAP(), 2026);
    expect(reply.actions.map((a) => a.id)).toEqual([
      "retire.ira",
      "retire.match",
      "oldplan.rollover",
      "open",
    ]);
    expect(
      yearlyReviewReply(REVIEW_SNAP({ advice: false }), 2026).actions.map((a) => a.id),
    ).toEqual(["open"]);
  });
});

// Spec step 231: the right investment in the right account.
const LOC_H = (
  ticker: string,
  valueCents: number,
  moveClass: "bonds" | "us_stocks" | null,
  gainCents = 0,
) => ({
  ticker,
  name: ticker,
  valueCents,
  moveClass,
  gainCents,
});
const LOC_ACCOUNTS: PlanAccount[] = [
  { id: "k", name: "401(k)", kind: "pre_tax", holdings: [LOC_H("KTSIX", 10_000_000, "us_stocks")] },
  {
    id: "t",
    name: "Brokerage",
    kind: "taxable",
    holdings: [LOC_H("KTBIX", 10_000_000, "bonds", 0)],
  },
];
const LOC_PLAN = locationPlan({
  accounts: LOC_ACCOUNTS,
  yieldBps: { bonds: 380, us_stocks: 170, intl_stocks: 290 },
  payoutRate: { bonds: 0.22, us_stocks: 0.15, intl_stocks: 0.15 },
  gainRate: 0.15,
});

describe("asset location questions, by rules", () => {
  it.each(["which accounts should hold my bonds", "where should i keep my bonds"])(
    "reads %j as asset location",
    (text) => {
      expect(parseIntent(text, ASOF)).toMatchObject({ kind: "investments", topic: "location" });
    },
  );
});

describe("locationReply and the location message", () => {
  const view = {
    advice: true,
    plan: LOC_PLAN,
    accounts: [],
    ordinaryRate: 0.22,
    gainRate: 0.15,
    fromEstimate: true,
  };
  it("says the tax saved, that the mix stays the same, and gives a tap for the swaps that cost no tax", () => {
    const reply = locationReply(view);
    expect(reply.body).toMatch(
      /from about \$836\.00 to \$255\.00 a year: \$581\.00 less\. Your overall mix stays exactly the same\./,
    );
    expect(reply.body).toMatch(/1 of 1 swap costs no tax/);
    expect(reply.actions.map((a) => a.id)).toEqual(["location.free", "open"]);
    expect(reply.refs).toEqual({ advice: true, locationKey: LOC_PLAN.key });
    expect(locationReply({ ...view, advice: false }).actions.map((a) => a.id)).toEqual(["open"]);
  });
  it("names the tax on a swap that sells at a gain, and gives it no button", () => {
    const gainy = locationPlan({
      accounts: [
        LOC_ACCOUNTS[0],
        { ...LOC_ACCOUNTS[1], holdings: [LOC_H("KTBIX", 10_000_000, "bonds", 1_000_000)] },
      ],
      yieldBps: { bonds: 380, us_stocks: 170, intl_stocks: 290 },
      payoutRate: { bonds: 0.22, us_stocks: 0.15, intl_stocks: 0.15 },
      gainRate: 0.15,
    });
    const reply = locationReply({ ...view, plan: gainy });
    expect(reply.body).toMatch(/\$1,500\.00 in tax\)/);
    expect(reply.actions.map((a) => a.id)).toEqual(["open"]);
  });
  it("posts once per plan, in demo advice mode only", () => {
    const gather = (plan: InvestmentSnapshot["location"]["plan"], advice = true) =>
      investmentsSource
        .gather(
          { ...base, investments: demoInvestmentSnapshot({ advice, location: { plan } }) },
          {} as never,
        )
        .filter((c) => c.dedupeKey.startsWith("location:"));
    expect(gather(LOC_PLAN)[0]).toMatchObject({
      kind: "decision",
      dedupeKey: `location:${LOC_PLAN.key}`,
    });
    expect(gather(LOC_PLAN, false)).toEqual([]);
    expect(gather(null)).toEqual([]);
  });
});
