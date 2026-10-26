import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { investmentsSource } from "@/lib/jane-agent/sources/investments";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { runHarness } from "@/detectors/harness";
import { formatCents } from "@/lib/money";
import { syncItem } from "@/lib/plaid/sync";
import { profileSummary } from "@/planning/investor-profile";
import { loadAccountPlan } from "./accounts";
import { loadFees } from "./fees";
import { loadRetirement } from "./retirement";
import { loadReview } from "./review";
import { loadReturns } from "./returns";
import { loadGoalBuckets } from "./goal-buckets";
import { estimateCollege } from "./college";
import { collectReceipts, investHsaCash, loadHsa } from "./hsa";
import { CompanyStockError, loadCompanyStock, saveGrant, sellPart } from "./company-stock";
import { cryptoTotal, loadCrypto, syncAllCrypto } from "@/lib/crypto/crypto";
import { CashError, loadCash, moveCash } from "./cash";
import {
  addChild,
  contributeForChild,
  createGiftLink,
  FamilyError,
  giftPage,
  giveGift,
  loadFamily,
  openChildAccount,
  revokeGiftLinks,
} from "./family";
import { startCollegePlan } from "./college";
import { loadLocation, makeSwaps, LocationError } from "./location";
import { loadHonest } from "./honest";
import {
  addDemoDeposit,
  classify,
  doStage,
  loadSuddenMoney,
  SuddenMoneyError,
} from "./sudden-money";
import {
  confirmBeneficiaries,
  exportFamilyFile,
  FamilyFileError,
  loadFamilyFile,
  recordEvent,
  saveBeneficiaries,
  saveContacts,
  savePicks,
} from "./family-file";
import { applyValues, loadValues, savePrefs, ValuesError } from "./values";
import { loadShortTerm, settleLadders, ShortTermError, startLadder } from "./short-term";
import {
  confirmMenu,
  loadPlanMenu,
  PlanMenuError,
  proposeMenu,
  requestPlanChange,
  sampleDisclosure,
} from "./plan-menu";
import { harvestFromReview, loadReviewExtras, ReviewError } from "./yearly-review";
import {
  answerPremium,
  loadCostlyProducts,
  linkDemoProducts,
  saveProduct,
  CostlyProductError,
} from "./costly-products";
import { addRental, linkDemoRental, loadProperty, PropertyError } from "./property";
import { automaticLog, runAutomaticInvesting } from "./automatic";
import {
  loadRetirementIncome,
  saveRetirementIncome,
  RetirementIncomeError,
} from "./retirement-income";
import { answerOldPlan, loadOldAccounts, startRollover, settleRollovers } from "./old-accounts";
import {
  contributeToIra,
  linkDemoRothIra,
  loadRetirementAccounts,
  requestMatchRaise,
  RetirementAccountsError,
} from "./retirement-accounts";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import { brokeragePartner, NoCryptoOrders } from "@/lib/brokerage/partner";
import { loadMoneyHub } from "@/lib/hubs/money";
import { setAutopilot } from "@/lib/autopilot";
import { takeSnapshots } from "@/lib/snapshots";
import { syncDemoInvestments } from "@/lib/plaid/sync";
import { loadInvestments } from "./holdings";
import { loadRebalance, placeRebalance, RebalanceError } from "./rebalance";
import { loadAutoInvest, runAutoInvest, setAutoInvestStatus, startAutoInvest } from "./auto-invest";
import { homeSummary } from "@/lib/home";
import { decideContribution } from "@/planning/auto-invest";
import { profileOf, saveProfileForm } from "./profile";

// Investments (spec steps 128–137) against a real, migrated Postgres (see
// src/detection/engine.integration.test.ts), on the demo bank.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
// Each test links and syncs a demo bank, then talks to Jane: slower than most.
const SLOW = { timeout: 60_000 };

describe.runIf(url)("investments in Jane's chat, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  async function demoPerson(now = LINKED) {
    const user = await client.user.create({
      data: { email: `inv-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now });
    await syncItem(itemId, { client, api: plaid, now });
    return user.id;
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("step 129: asks the four questions in one message and saves each tap", SLOW, async () => {
    const userId = await demoPerson();
    const snapshot = await loadSnapshot(userId, { client, now: LINKED });
    expect(snapshot?.investments).toMatchObject({ advice: true, holdingCount: 9 });
    const question = investmentsSource
      .gather(snapshot!, {} as never)
      .find((c) => c.dedupeKey === "profile");
    expect(question?.refs.investQuestion).toBe("age");

    // Typed, the same questions come with their buttons.
    const { reply } = await sendToJane(userId, "what's my risk profile", { client, now: LINKED });
    expect(reply.refs).toMatchObject({ investQuestion: "age", note: "1 of 4: How old are you?" });

    const tap = async (actionId: string) =>
      (await takeChatAction(userId, reply.id, actionId, { client, now: LINKED })).message;
    let message = await tap("invest.answer.3"); // 40s
    expect(message).toMatchObject({
      status: "open",
      refs: { investQuestion: "horizon", note: "2 of 4: When will you need most of this money?" },
    });
    expect((await profileOf(userId, { client })).answeredAt).toBeNull();
    message = await tap("invest.answer.4"); // 20 years or more
    message = await tap("invest.answer.2"); // worry, but wait
    // Nothing uses the profile before the last answer.
    expect(profileSummary(await profileOf(userId, { client }), "2026-10-18").complete).toBe(false);
    message = await tap("invest.answer.1"); // retirement
    expect(message).toMatchObject({ status: "answered", answeredWith: "Retirement" });
    expect(message.refs.note).toBe(
      "Thanks. Your profile: Medium: you'd worry, but wait it out after a drop, so less risk than your timeline allows. You can change it any time.",
    );
    const profile = await profileOf(userId, { client });
    expect(profile).toMatchObject({
      age: 45,
      ageOn: "2026-10-18",
      horizon: "over_20",
      dropReaction: "worry",
      goals: ["retirement"],
    });
    expect(profile.answeredAt).toEqual(LINKED);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "investor_profile_saved",
      { type: "user", id: userId },
      { changed: "goal", complete: true },
    );
    // Answered: Jane stops asking.
    const after = await loadSnapshot(userId, { client, now: LINKED });
    expect(investmentsSource.gather(after!, {} as never).map((c) => c.dedupeKey)).not.toContain(
      "profile",
    );

    // Changed any time on the page; the first time it was finished is kept.
    await saveProfileForm(
      userId,
      { age: "47", horizon: "3_to_10", dropReaction: "fine", goals: ["home", "growth"] },
      { client, now: new Date("2026-11-01T00:00:00Z") },
    );
    expect(await profileOf(userId, { client })).toMatchObject({
      age: 47,
      horizon: "3_to_10",
      goals: ["home", "growth"],
      answeredAt: LINKED,
    });
  });

  it("step 129: never asks someone with a real account, who gets no advice", SLOW, async () => {
    const userId = await demoPerson();
    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    const snapshot = await loadSnapshot(userId, { client, now: LINKED });
    expect(snapshot?.investments?.advice).toBe(false);
    expect(
      investmentsSource.gather(snapshot!, {} as never).some((c) => c.dedupeKey === "profile"),
    ).toBe(false);
  });

  it("step 130: fees come from the synced holdings and fee records", SLOW, async () => {
    const userId = await demoPerson();
    const { fees } = await loadFees(userId, { client, now: LINKED });
    // Four quarterly advisory and plan fees in the 12 months before linking.
    expect(fees.advisoryCents).toBe(12_480);
    expect(fees.accountFeesCents).toBe(5_000);
    expect(fees.equivalents.map((e) => e.ticker)).toEqual(["KTRGX", "KTSIX", "KDVX"]);
    const { reply } = await sendToJane(userId, "what are my investment fees", {
      client,
      now: LINKED,
    });
    expect(reply.refs.advice).toBe(true);
    expect(reply.body).toContain("Lower-cost equivalents:");
  });

  it("step 131: reviews against the profile once it's answered", SLOW, async () => {
    const userId = await demoPerson();
    expect((await loadReview(userId, { client, now: LINKED })).review).toBeNull();
    await saveProfileForm(
      userId,
      { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
      { client, now: LINKED },
    );
    const { review } = await loadReview(userId, { client, now: LINKED });
    expect(review).toMatchObject({ riskLevel: 3, offTarget: true, totalCents: 9_673_055 });
    expect(review?.recommendations[0].kind).toBe("rebalance");
    const { reply } = await sendToJane(userId, "review my portfolio", { client, now: LINKED });
    expect(reply.refs.advice).toBe(true);
    expect(reply.body).toMatch(/^Against your medium profile/);
  });

  it("step 132: plans retirement from the contributions and the plan's match", SLOW, async () => {
    const userId = await demoPerson();
    expect((await loadRetirement(userId, { client, now: LINKED })).retirement).toBeNull();
    await saveProfileForm(
      userId,
      { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
      { client, now: LINKED },
    );
    const { retirement, balanceCents, accounts } = await loadRetirement(userId, {
      client,
      now: LINKED,
    });
    expect(balanceCents).toBe(8_425_040);
    expect(accounts).toEqual(["Demo 401(k)"]);
    // 24 paydays in the 12 months before linking: 4% of pay, and half of that matched.
    expect(retirement?.match).toEqual({
      employeeRate: 0.04,
      captured: false,
      missedCents: 81_600,
      fullMatchRate: 0.06,
    });
    expect(retirement?.status).toBe("behind");
    const { reply } = await sendToJane(userId, "am I on track for retirement", {
      client,
      now: LINKED,
    });
    expect(reply.refs.advice).toBe(true);
    expect(reply.body).toMatch(/^By 67 your retirement accounts could be about/);
  });

  it("step 133: one tap places simulated orders that move to the target mix", SLOW, async () => {
    const userId = await demoPerson();
    await saveProfileForm(
      userId,
      { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
      { client, now: LINKED },
    );
    const before = await loadInvestments(userId, { client, now: LINKED });
    const { plan } = await loadRebalance(userId, { client, now: LINKED });
    expect(plan!.orders.length).toBeGreaterThan(0);

    // The review message carries the button and the plan's key.
    const snapshot = await loadSnapshot(userId, { client, now: LINKED });
    const review = investmentsSource
      .gather(snapshot!, {} as never)
      .find((c) => c.dedupeKey.startsWith("review:"))!;
    expect(review.actions[0]).toMatchObject({ id: "invest.rebalance" });
    expect(review.refs.rebalanceKey).toBe(plan!.key);

    await expect(placeRebalance(userId, "stale", { client, now: LINKED })).rejects.toThrow(
      RebalanceError,
    );
    const { reply } = await sendToJane(userId, "rebalance", { client, now: LINKED });
    expect(reply.refs.rebalanceKey).toBe(plan!.key);
    const { message } = await takeChatAction(userId, reply.id, "invest.rebalance", {
      client,
      now: LINKED,
    });
    expect(message.refs.note).toMatch(
      /^Done in the simulated brokerage \(no real money moves\): \d+ of \d+ orders filled\. Your mix is now 40% US stocks, 20% international stocks, 35% bonds, 5% cash\.$/,
    );
    const orders = await client.brokerageOrder.findMany({ where: { userId } });
    expect(orders.every((o) => o.partner === "simulated" && o.status === "filled")).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "brokerage_orders_placed",
      expect.objectContaining({ type: "brokerage_batch" }),
      { reason: "rebalance", orders: orders.length, simulated: true },
    );

    // The holdings show the new mix; each account's total is unchanged; nothing left to do.
    const after = await loadInvestments(userId, { client, now: LINKED });
    for (const a of after.accounts) {
      const was = before.accounts.find((b) => b.id === a.id)!;
      expect(a.holdingsCents, a.name).toBe(was.holdingsCents);
      expect(a.holdingsMatch, a.name).toBe(true);
    }
    expect((await loadRebalance(userId, { client, now: LINKED })).plan!.orders).toEqual([]);
    // And they stay that way through a full sync of the demo bank: prices have moved a
    // little (spec step 156), but the mix is still on target.
    const item = await client.plaidItem.findFirstOrThrow({ where: { userId } });
    const later = new Date("2026-10-20T15:00:00Z");
    await syncItem(item.id, { client, api: plaid, now: later });
    expect((await loadReview(userId, { client, now: later })).review?.offTarget).toBe(false);
    expect(
      await client.investmentTransaction.count({
        where: { userId, plaidInvestmentTransactionId: { contains: "-order-" } },
      }),
    ).toBe(orders.length);
    // Tapping again changes nothing.
    await expect(
      takeChatAction(userId, reply.id, "invest.rebalance", { client, now: LINKED }),
    ).rejects.toThrow();
  });

  it("step 133: never trades for a real account", SLOW, async () => {
    const userId = await demoPerson();
    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    await saveProfileForm(
      userId,
      { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
      { client, now: LINKED },
    );
    expect((await loadRebalance(userId, { client, now: LINKED })).plan).toBeNull();
    await expect(placeRebalance(userId, "any", { client, now: LINKED })).rejects.toThrow(
      "Trading is only in demo advice mode for now.",
    );
    expect(await client.brokerageOrder.count({ where: { userId } })).toBe(0);
  });

  it("step 134: suggests from the paycheck, not a payout that landed after it", SLOW, async () => {
    // Linked on the 25th, the demo's $1,150 Airbnb payout (a week before linking) comes after
    // the $2,450 payroll on the 15th.
    const late = new Date("2026-10-25T15:00:00Z");
    const userId = await demoPerson(late);
    const offer = await loadAutoInvest(userId, { client, now: late });
    expect(offer.suggestion?.amountCents).toBe(10_000);
  });

  it(
    "step 134: invests each new paycheck by itself, only what safe to spend doesn't need",
    SLOW,
    async () => {
      const userId = await demoPerson();
      await saveProfileForm(
        userId,
        { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
        { client, now: LINKED },
      );
      const offer = await loadAutoInvest(userId, { client, now: LINKED });
      // 5% of the $2,450 paycheck, rounded down to $25, into the brokerage (not the 401(k)).
      expect(offer.suggestion?.amountCents).toBe(10_000);
      expect(offer.accounts.map((a) => a.name)).toEqual(["Demo Brokerage"]);
      const brokerage = offer.accounts[0].id;
      const before = (await loadInvestments(userId, { client, now: LINKED })).accounts.find(
        (a) => a.id === brokerage,
      )!;

      const safe =
        (await homeSummary(userId, { client, now: LINKED }))?.safeToSpend?.safeCents ?? null;
      const expected = decideContribution({ mode: "fixed", amountCents: 10_000, safeCents: safe });
      // Started with a tap: runs at once for the Oct 15 paycheck.
      const run = await startAutoInvest(
        userId,
        { mode: "fixed", amountCents: 10_000, accountId: brokerage },
        { client, now: LINKED },
      );
      expect(run).toMatchObject({ paydayOn: "2026-10-15", status: expected.status });
      const runs = await client.autoInvestRun.findMany({ where: { userId } });
      expect(runs).toHaveLength(1);
      if (expected.status === "invested") {
        const after = (await loadInvestments(userId, { client, now: LINKED })).accounts.find(
          (a) => a.id === brokerage,
        )!;
        expect(after.balanceCents).toBe((before.balanceCents ?? 0) + expected.amountCents);
        expect(after.holdingsMatch).toBe(true);
        const orders = await client.brokerageOrder.findMany({
          where: { userId, reason: "auto_invest" },
        });
        expect(orders.map((o) => o.side).sort()).toEqual(["buy", "buy", "buy", "deposit"]);
      }
      // The same paycheck never runs twice; paused runs nothing.
      expect(await runAutoInvest(userId, { client, now: LINKED })).toBeNull();
      await setAutoInvestStatus(userId, "paused", { client });
      expect(
        await runAutoInvest(userId, { client, now: new Date("2026-11-02T15:00:00Z") }),
      ).toBeNull();
      // Typed, Jane says it's paused and offers to turn it back on.
      const { reply } = await sendToJane(userId, "automatic investing", { client, now: LINKED });
      expect(reply.body).toMatch(/^Automatic investing is paused \(\$100\.00 every payday\)\./);
      expect(reply.actions[0]).toMatchObject({ id: "invest.auto_resume" });
      await takeChatAction(userId, reply.id, "invest.auto_resume", { client, now: LINKED });
      expect((await loadAutoInvest(userId, { client, now: LINKED })).plan?.status).toBe("active");
    },
  );

  it(
    "step 135: the account order follows the profile, from the match and the tax estimate",
    SLOW,
    async () => {
      const userId = await demoPerson();
      expect((await loadAccountPlan(userId, { client, now: LINKED })).order).toBeNull();
      await saveProfileForm(
        userId,
        { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
        { client, now: LINKED },
      );
      const plan = await loadAccountPlan(userId, { client, now: LINKED });
      expect(plan.order?.map((s) => s.key)).toEqual([
        "match",
        "hsa",
        "ira",
        "workplace",
        "taxable",
      ]);
      expect(plan.location.map((m) => m.holding.ticker)).toEqual(["PDIFX"]);
      expect(plan.gains.losers[0].name).toBe("Pinnacle Dividend Income Fund");
      // Saving for a home soon reorders it.
      await saveProfileForm(
        userId,
        { age: "45", horizon: "3_to_10", dropReaction: "worry", goals: ["home"] },
        { client, now: LINKED },
      );
      expect((await loadAccountPlan(userId, { client, now: LINKED })).order?.[1].key).toBe(
        "flexible",
      );
      const { reply } = await sendToJane(userId, "which account should I invest in first", {
        client,
        now: LINKED,
      });
      expect(reply.refs.advice).toBe(true);
      expect(reply.body).toMatch(/^Fill the 401\(k\) match first, then /);
    },
  );

  it(
    "step 137: the monthly note from what went in last month, at most one decision",
    SLOW,
    async () => {
      const userId = await demoPerson();
      const snapshot = await loadSnapshot(userId, { client, now: LINKED });
      // September's two paydays: 4% of pay and half of that matched, twice.
      expect(snapshot?.investments?.month).toMatchObject({
        month: "2026-10",
        contributedCents: 40_800,
      });
      const note = investmentsSource
        .gather(snapshot!, {} as never)
        .find((c) => c.dedupeKey === "monthly:2026-10")!;
      expect(note.body).toMatch(
        /^Your investments start October at \$96,730\.55\. \$408\.00 went in last month\./,
      );
      expect(
        note.actions.filter((a) => a.kind !== "link" && a.id !== "snooze").length,
      ).toBeLessThanOrEqual(1);
    },
  );

  it(
    "step 156: returns from snapshots and the price feed, leaving out money paid in",
    SLOW,
    async () => {
      const userId = await demoPerson();
      await saveProfileForm(
        userId,
        { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
        { client, now: LINKED },
      );
      const day = (n: number) => new Date(LINKED.getTime() + n * 86_400_000);
      // The daily job: snapshot, then invest the Oct 15 paycheck, then prices move.
      await takeSnapshots({ client, now: day(0) });
      const brokerage = (await loadAutoInvest(userId, { client, now: day(0) })).accounts[0].id;
      await startAutoInvest(
        userId,
        { mode: "fixed", amountCents: 10_000, accountId: brokerage },
        { client, now: day(0) },
      );
      const item = await client.plaidItem.findFirstOrThrow({ where: { userId } });
      await syncDemoInvestments(item.id, { client, now: day(2) });
      await takeSnapshots({ client, now: day(1) });

      const returns = await loadReturns(userId, { client, now: day(2) });
      expect(returns.simulatedPrices).toBe(true);
      expect(returns.periods.map((p) => p.key)).toEqual(["1m", "3m", "1y"]);
      const month = returns.periods[0];
      expect(month.paidInCents).toBe(10_000);
      // The $100 deposit is money in, not a gain: the investments' own return leaves it out.
      const naive = month.endCents / month.startCents - 1;
      expect(month.timeWeighted!).toBeLessThan(naive);
      expect(month.benchmark).not.toBeNull();
      // Dividends and interest from the demo's own transactions.
      expect(returns.periods[2].incomeCents).toBeGreaterThan(0);
    },
  );

  it("step 157: at the safe level, new money goes by goal, near-term in cash", SLOW, async () => {
    const userId = await demoPerson();
    await saveProfileForm(
      userId,
      { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement", "home"] },
      { client, now: LINKED },
    );
    // A house in two years, saved by hand so far.
    await client.savingsGoal.create({
      data: {
        userId,
        name: "House",
        targetCents: 3_000_000,
        targetDate: new Date("2028-10-01"),
        manualSavedCents: 0,
      },
    });
    await setAutopilot(userId, "safe", { client, now: LINKED });
    const { buckets, byHerself } = await loadGoalBuckets(userId, { client, now: LINKED });
    expect(byHerself).toBe(true);
    expect(buckets?.map((b) => [b.name, b.nearTerm])).toEqual([
      ["House", true],
      ["Retirement", false],
    ]);
    const brokerage = (await loadAutoInvest(userId, { client, now: LINKED })).accounts[0].id;
    const run = await startAutoInvest(
      userId,
      { mode: "fixed", amountCents: 10_000, accountId: brokerage },
      { client, now: LINKED },
    );
    expect(run?.status).toBe("invested");
    // The house needs more than $100 a month, so all of it stays in cash: nothing is bought.
    const orders = await client.brokerageOrder.findMany({
      where: { userId, reason: "auto_invest" },
    });
    expect(orders.map((o) => o.side)).toEqual(["deposit"]);
    const saved = await client.autoInvestRun.findFirstOrThrow({ where: { userId } });
    expect(saved.reason).toBe("By goal: House $100.00");
  });

  it(
    "step 158: college for a 5 year old, with the state's break, set up as a goal",
    SLOW,
    async () => {
      const userId = await demoPerson();
      await saveProfileForm(
        userId,
        { age: "40", horizon: "over_20", dropReaction: "worry", goals: ["education"] },
        { client, now: LINKED },
      );
      await client.taxProfile.create({
        data: {
          userId,
          state: "NY",
          filingStatus: "single",
          childrenUnder17: 1,
          answered: ["state", "filingStatus", "dependants"],
        },
      });
      const estimate = await estimateCollege(userId, { childAge: 5, type: "public" }, { client });
      expect(estimate.state).toBe("NY");
      expect(estimate.plans[0]).toMatchObject({ plan: { key: "home" } });
      expect(estimate.plans[0].benefitCents).toBeGreaterThan(0);

      const { reply } = await sendToJane(userId, "save for college for my 5 year old", {
        client,
        now: LINKED,
      });
      expect(reply.refs.college).toEqual({ childName: "your child", childAge: 5, type: "public" });
      const { message } = await takeChatAction(userId, reply.id, "college.start", {
        client,
        now: LINKED,
      });
      expect(message.refs.note).toMatch(/^Done: a goal of \$[\d,.]+ by September 2039\./);
      const plan = await client.collegePlan.findFirstOrThrow({ where: { userId } });
      const goal = await client.savingsGoal.findUniqueOrThrow({ where: { id: plan.goalId! } });
      expect(goal.name).toBe("College for your child");
      // The goal joins the buckets (step 157): 13 years away, invested.
      const { buckets } = await loadGoalBuckets(userId, { client, now: LINKED });
      expect(buckets?.find((b) => b.id === goal.id)).toMatchObject({ nearTerm: false });
    },
  );

  it(
    "step 159: receipts saved on its own, a demo HSA, its extra cash invested with a tap",
    SLOW,
    async () => {
      const userId = await demoPerson();
      // The demo bank's pharmacy, dentist and imaging charges (the imaging bill is from last
      // year, spec step 200), saved by Jane's brain on the first sync on its own, once each.
      expect(await client.hsaReceipt.count({ where: { userId } })).toBe(4);
      expect(await collectReceipts(userId, { client, now: LINKED })).toBe(0);
      // Two collections at once (a page and the brain) save each charge once, without error.
      await client.hsaReceipt.deleteMany({ where: { userId } });
      const both = await Promise.all([
        collectReceipts(userId, { client, now: LINKED }),
        collectReceipts(userId, { client, now: LINKED }),
      ]);
      expect(both[0] + both[1]).toBe(4);
      expect(await client.hsaReceipt.count({ where: { userId } })).toBe(4);
      const receipts = await client.hsaReceipt.findMany({
        where: { userId },
        include: { transaction: true },
      });
      expect(receipts.every((r) => r.transaction.amountCents === r.amountCents)).toBe(true);
      expect(receipts.reduce((s, r) => s + r.amountCents, 0)).toBe(92_680);

      const snapshot = await loadSnapshot(userId, { client, now: LINKED });
      const offer = investmentsSource
        .gather(snapshot!, {} as never)
        .find((c) => c.dedupeKey === "hsa:link")!;
      const posted = await client.janeMessage.create({
        data: {
          userId,
          kind: offer.kind,
          body: offer.body,
          refs: offer.refs,
          actions: offer.actions,
          dedupeKey: "test:hsa:link",
        },
      });
      await takeChatAction(userId, posted.id, "hsa.link", { client, now: LINKED });
      const hsa = await loadHsa(userId, { client, now: LINKED });
      expect(hsa.account).toMatchObject({ name: "Demo HSA", balanceCents: 427_180 });
      expect(hsa.plan).toMatchObject({ cashCents: 285_000, toInvestCents: 85_000 });

      const { amountCents } = await investHsaCash(userId, { client, now: LINKED });
      expect(amountCents).toBe(85_000);
      expect((await loadHsa(userId, { client, now: LINKED })).plan?.toInvestCents).toBe(0);
    },
  );

  it(
    "step 160: a demo stock plan, the plan to sell down with its tax, one part sold with a tap",
    SLOW,
    async () => {
      const userId = await demoPerson();
      // The demo bank alone: 38 Acme shares in the brokerage, under the limit.
      const before = await loadCompanyStock(userId, { client, now: LINKED });
      expect(before).toMatchObject({ company: "Acme Corp", ticker: "ACME", demo: true });
      expect(before.concentration.overLimit).toBe(false);
      expect(before.plan?.parts ?? []).toEqual([]);

      const offer = (await sendToJane(userId, "my rsus", { client, now: LINKED })).reply;
      expect(offer.actions.map((a) => a.id)).toEqual(["open"]);
      const posted = await client.janeMessage.create({
        data: {
          userId,
          kind: "decision",
          body: "Want to try a demo stock plan?",
          refs: {},
          actions: [{ id: "company.link", label: "Link a demo stock plan", kind: "primary" }],
          dedupeKey: "test:company:link",
        },
      });
      await takeChatAction(userId, posted.id, "company.link", { client, now: LINKED });

      const view = await loadCompanyStock(userId, { client, now: LINKED });
      expect(view.holdings.map((h) => [h.accountName, h.quantity])).toEqual(
        expect.arrayContaining([
          ["Demo Stock Plan", 150],
          ["Demo Brokerage", 38],
        ]),
      );
      expect(view.grants).toMatchObject([{ kind: "rsu", unvestedShares: 120, source: "demo" }]);
      expect(view.concentration.overLimit).toBe(true);
      expect(view.concentration.shareWithUnvested).toBeGreaterThan(view.concentration.share);
      const plan = view.plan!;
      expect(plan.accountName).toBe("Demo Stock Plan");
      expect(plan.parts.length).toBeGreaterThan(1);
      expect(plan.parts[0].on).toBe("2026-10-18");
      expect(plan.taxCents).toBeGreaterThan(0);
      expect(plan.shareAfter).toBeCloseTo(0.1, 2);
      // Nothing is sold without the tap.
      expect(await client.brokerageOrder.count({ where: { userId, reason: "diversify" } })).toBe(0);

      // Jane's message, then the tap.
      const snapshot = await loadSnapshot(userId, { client, now: LINKED });
      const message = investmentsSource
        .gather(snapshot!, {} as never)
        .find((c) => c.dedupeKey.startsWith("company:sell:"))!;
      expect(message.refs).toEqual({ advice: true, companyPlan: plan.key });
      const decision = await client.janeMessage.create({
        data: {
          userId,
          kind: message.kind,
          body: message.body,
          refs: message.refs,
          actions: message.actions,
          dedupeKey: "test:company:sell",
        },
      });
      const { message: done } = await takeChatAction(userId, decision.id, "company.sell", {
        client,
        now: LINKED,
      });
      expect(done.refs.note).toMatch(
        /^Done in the simulated brokerage \(no real money moves\): sold/,
      );
      const orders = await client.brokerageOrder.findMany({
        where: { userId, reason: "diversify" },
      });
      expect(orders.find((o) => o.side === "sell")).toMatchObject({ ticker: "ACME" });
      expect(orders.filter((o) => o.side === "buy").length).toBeGreaterThan(0);

      // The next part waits three months; selling again now is refused.
      const after = await loadCompanyStock(userId, { client, now: LINKED });
      expect(after.concentration.share).toBeLessThan(view.concentration.share);
      expect(after.plan?.parts[0].on).toBe("2027-01-18");
      await expect(sellPart(userId, after.plan!.key, { client, now: LINKED })).rejects.toThrow(
        CompanyStockError,
      );
      await expect(sellPart(userId, plan.key, { client, now: LINKED })).rejects.toThrow(
        /changed since this plan/,
      );

      // The guided form checks what it saves.
      await expect(
        saveGrant(
          userId,
          {
            company: "",
            ticker: "",
            kind: "rsu",
            unvestedShares: "1",
            sharesPerVest: "",
            everyMonths: "",
            nextVestOn: "",
          },
          { client },
        ),
      ).rejects.toThrow(/company's name/);
    },
  );

  it(
    "step 161: crypto read-only, labelled with its source and time, in net worth, never traded",
    SLOW,
    async () => {
      const userId = await demoPerson();
      const reply = (
        await sendToJane(userId, "how much bitcoin do I have", { client, now: LINKED })
      ).reply;
      expect(reply.body).toMatch(/^I don't see any crypto\./);
      const posted = await client.janeMessage.create({
        data: {
          userId,
          kind: "decision",
          body: reply.body,
          refs: {},
          actions: reply.actions,
          dedupeKey: "test:crypto:link",
        },
      });
      const { message } = await takeChatAction(userId, posted.id, "crypto.link", {
        client,
        now: LINKED,
      });
      expect(message.refs.note).toMatch(/^Connected, read-only\./);

      const view = await loadCrypto(userId, { client, now: LINKED });
      expect(view.connections).toMatchObject([
        {
          kind: "exchange",
          name: "Demo Exchange",
          source: "Demo Exchange (demo, sample data), read-only",
          asOf: LINKED,
          stale: false,
        },
      ]);
      expect(view.holdings.map((h) => h.asset).sort()).toEqual(["BTC", "ETH", "SOL", "USDC"]);
      expect(view.holdings.every((h) => h.asOf.getTime() === LINKED.getTime())).toBe(true);
      expect(view.size.overShare).toBe(true);
      expect(view.fees).toMatchObject({ bps: 149, flag: true });

      // In net worth, at what the exchange reported.
      const total = await cryptoTotal(userId, { client });
      expect(total).toBe(view.size.totalCents);
      const { netWorth } = await loadMoneyHub(userId, { client, now: LINKED });
      expect(netWorth.cryptoCents).toBe(total);
      expect(netWorth.assetsCents).toBeGreaterThan(netWorth.investmentsCents + total);

      // Jane's messages: seen, then the two flags; none can trade.
      const snapshot = await loadSnapshot(userId, { client, now: LINKED });
      const messages = investmentsSource
        .gather(snapshot!, {} as never)
        .filter((c) => c.dedupeKey.startsWith("crypto:"));
      expect(messages.map((m) => m.dedupeKey)).toEqual([
        "crypto:seen",
        "crypto:share",
        "crypto:fees",
      ]);

      // No order path: the brokerage refuses crypto, and records nothing.
      await expect(
        brokeragePartner().placeOrders(
          userId,
          {
            batchId: crypto.randomUUID(),
            reason: "test",
            orders: [
              {
                accountId: view.connections[0].id,
                ticker: "BTC",
                securityName: "Bitcoin",
                side: "sell",
                amountCents: 10_000,
              },
            ],
          },
          { client, now: LINKED },
        ),
      ).rejects.toBeInstanceOf(NoCryptoOrders);
      expect(await client.brokerageOrder.count({ where: { userId, ticker: "BTC" } })).toBe(0);

      // The nightly run reads the balances again, a day later, at that day's prices.
      const tomorrow = new Date(LINKED.getTime() + 86_400_000);
      expect((await syncAllCrypto({ client, now: tomorrow })).synced).toBeGreaterThan(0);
      const later = await loadCrypto(userId, { client, now: tomorrow });
      expect(later.connections[0].asOf).toEqual(tomorrow);
    },
  );

  it(
    "step 162: cash with a job each, the emergency fund in reach, each move a tap",
    SLOW,
    async () => {
      const userId = await demoPerson();
      const view = await loadCash(userId, { client, now: LINKED });
      expect(view.places.map((p) => [p.name, p.kind])).toEqual([
        ["Demo Checking", "checking"],
        ["Demo Savings", "savings"],
        ["Demo Brokerage cash", "sweep"],
      ]);
      const plan = view.plan!;
      expect(plan.buckets.find((b) => b.key === "emergency")!.home!.reachDays).toBeLessThanOrEqual(
        3,
      );
      expect(plan.gainCents).toBeGreaterThan(0);
      expect(plan.moves.map((m) => m.key)).toContain("sweep_to_money_market");
      // Nothing moved yet.
      expect(await client.moneyTransfer.count({ where: { userId, purpose: "cash" } })).toBe(0);

      // Jane's message, then the money market tap.
      const snapshot = await loadSnapshot(userId, { client, now: LINKED });
      const offer = investmentsSource
        .gather(snapshot!, {} as never)
        .find((c) => c.dedupeKey.startsWith("cash:"))!;
      expect(offer.refs).toEqual({ advice: true, cashPlan: plan.key });
      const posted = await client.janeMessage.create({
        data: {
          userId,
          kind: offer.kind,
          body: offer.body,
          refs: offer.refs,
          actions: offer.actions,
          dedupeKey: "test:cash",
        },
      });
      const { message } = await takeChatAction(userId, posted.id, "cash.to_money_market", {
        client,
        now: LINKED,
      });
      expect(message.refs.note).toMatch(
        /money market fund\. It can be sold the next business day\.$/,
      );
      const after = await loadCash(userId, { client, now: LINKED });
      expect(after.places.find((p) => p.kind === "sweep")).toBeUndefined();
      const held = await loadInvestments(userId, { client, now: LINKED });
      expect(
        held.accounts.flatMap((a) => a.holdings).find((h) => h.ticker === "KMMXX"),
      ).toBeTruthy();

      // A checking move, when there is one, goes through the money-movement stand-in.
      const move = after.plan!.moves.find((m) => m.key === "checking_to_savings");
      if (move) {
        await moveCash(userId, after.plan!.key, move.key, { client, now: LINKED });
        expect(
          await client.moneyTransfer.findFirst({ where: { userId, purpose: "cash" } }),
        ).toMatchObject({ amountCents: move.cents, by: "person" });
      }
      // A plan that changed is refused.
      await expect(
        moveCash(userId, plan.key, "sweep_to_money_market", { client, now: LINKED }),
      ).rejects.toThrow(CashError);
    },
  );

  it(
    "step 164: nothing below Everything allowed, a cap bounds every move, each is in the log with its reason",
    SLOW,
    async () => {
      const userId = await demoPerson();
      await saveProfileForm(
        userId,
        { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
        { client, now: LINKED },
      );
      const orders = () => client.brokerageOrder.count({ where: { userId } });
      // At "Always ask" (the default), "The safe stuff", nothing happens by itself.
      expect(await runAutomaticInvesting(userId, { client, now: LINKED })).toBeNull();
      await setSectorAutopilot(
        userId,
        "investing",
        { level: "safe", actionCapCents: 5_000_000, monthlyCapCents: 5_000_000 },
        { client, now: LINKED },
      );
      expect(await runAutomaticInvesting(userId, { client, now: LINKED })).toBeNull();
      expect(await orders()).toBe(0);

      // Step 57's level wins over a sector's: "Ask me first" asks everywhere.
      await setAutopilot(userId, "safe", { client, now: LINKED });
      // Everything allowed, but a cap of $1: the rebalance is asked about, once, and not done.
      await setSectorAutopilot(
        userId,
        "investing",
        { level: "all", actionCapCents: 100, monthlyCapCents: 100 },
        { client, now: LINKED },
      );
      const over = await runAutomaticInvesting(userId, { client, now: LINKED });
      expect(over!.did).toEqual([]);
      expect(over!.asked[0]).toMatch(/^Asked first, over the cap on one move: Rebalanced \$/);
      await runAutomaticInvesting(userId, { client, now: LINKED });
      expect(await orders()).toBe(0);
      expect((await automaticLog(userId, { client, now: LINKED })).asked).toHaveLength(1);

      // With room under the caps, it does it, and the log says what and why.
      await setSectorAutopilot(
        userId,
        "investing",
        { actionCapCents: 5_000_000, monthlyCapCents: 5_000_000 },
        { client, now: LINKED },
      );
      const done = await runAutomaticInvesting(userId, { client, now: LINKED });
      expect(done!.did[0]).toMatch(
        /^Rebalanced \$[\d,.]+ to your target mix \(it had drifted off target\)$/,
      );
      expect(await orders()).toBeGreaterThan(0);
      const log = await automaticLog(userId, { client, now: LINKED });
      expect(log.did.map((d) => d.what)).toEqual(done!.did);
      expect(log.did[0].cents).toBeGreaterThan(0);

      // Jane's monthly summary says it, with the simulated-money line.
      const snapshot = await loadSnapshot(userId, { client, now: LINKED });
      const summary = investmentsSource
        .gather(snapshot!, {} as never)
        .find((c) => c.dedupeKey.startsWith("investing:summary:"))!;
      expect(summary.body).toMatch(/^This month I handled 1 thing in your investments by myself/);
      expect(summary.body).toMatch(/Over your caps, so waiting for your tap: Rebalanced/);
      expect(summary.body).toMatch(/no real money moved\.$/);
    },
  );

  it(
    "step 210: limits across accounts, the missed match in dollars, a payroll request and an IRA contribution, each a tap",
    SLOW,
    async () => {
      const userId = await demoPerson();
      const before = await loadRetirementAccounts(userId, { client, now: LINKED });
      expect(before.limits.map((l) => l.key)).toEqual(["workplace", "ira"]);
      expect(before.limits[0].usedCents).toBeGreaterThan(0);
      expect(before.limits[0].roomCents).toBe(
        before.limits[0].limitCents - before.limits[0].usedCents,
      );
      expect(before.match!.missedCents).toBeGreaterThan(0);
      expect(before.ira).toBeNull();
      expect(await client.payrollChange.count({ where: { userId } })).toBe(0);

      // Chat: the message, then the tap, through the payroll stand-in.
      const snapshot = await loadSnapshot(userId, { client, now: LINKED });
      const offer = investmentsSource
        .gather(snapshot!, {} as never)
        .find((c) => c.dedupeKey.startsWith("retire:match:"))!;
      const posted = await client.janeMessage.create({
        data: {
          userId,
          kind: offer.kind,
          body: offer.body,
          refs: offer.refs,
          actions: offer.actions,
          dedupeKey: "test:retire:match",
        },
      });
      const { message } = await takeChatAction(userId, posted.id, "retire.match", {
        client,
        now: LINKED,
      });
      expect(message.refs.note).toMatch(
        /^Requested through the payroll stand-in \(no real pay changes yet\): 6% of pay from 2026-10-25/,
      );
      const change = await client.payrollChange.findFirstOrThrow({ where: { userId } });
      expect(change).toMatchObject({ partner: "stand-in", status: "requested", toRate: 0.06 });
      await expect(requestMatchRaise(userId, { client, now: LINKED })).rejects.toThrow(
        RetirementAccountsError,
      );

      // A demo Roth IRA, and money in it through the simulated brokerage.
      await linkDemoRothIra(userId, { client, now: LINKED });
      const withIra = await loadRetirementAccounts(userId, { client, now: LINKED });
      expect(withIra.ira).toMatchObject({ name: "Demo Roth IRA", roth: true });
      const room = withIra.limits[1].roomCents;
      expect(withIra.iraAllowedCents).toBeLessThanOrEqual(room);
      await expect(contributeToIra(userId, room + 1, { client, now: LINKED })).rejects.toThrow(
        /more than you can/,
      );
      await contributeToIra(userId, 100_000, { client, now: LINKED });
      const after = await loadRetirementAccounts(userId, { client, now: LINKED });
      expect(after.limits[1].usedCents).toBe(100_000);
      expect(after.limits[1].roomCents).toBe(room - 100_000);
      expect(
        await client.brokerageOrder.count({ where: { userId, reason: "ira_contribution" } }),
      ).toBe(2);
    },
  );

  it(
    "step 211: a past employer asked once, its fees compared, a direct rollover tracked and never a withdrawal",
    SLOW,
    async () => {
      const userId = await demoPerson();
      const first = await loadOldAccounts(userId, { client, now: LINKED });
      expect(first.plans).toMatchObject([{ employer: "Globex Industries", status: "asked" }]);
      // Asked once: loading again adds nothing.
      expect((await loadOldAccounts(userId, { client, now: LINKED })).plans).toHaveLength(1);

      // The question in the chat, answered Yes.
      const snapshot = await loadSnapshot(userId, { client, now: LINKED });
      const ask = investmentsSource
        .gather(snapshot!, {} as never)
        .find((c) => c.dedupeKey.startsWith("oldplan:ask:"))!;
      const posted = await client.janeMessage.create({
        data: {
          userId,
          kind: ask.kind,
          body: ask.body,
          refs: ask.refs,
          actions: ask.actions,
          dedupeKey: "test:oldplan",
        },
      });
      await takeChatAction(userId, posted.id, "oldplan.yes", { client, now: LINKED });
      const found = (await loadOldAccounts(userId, { client, now: LINKED })).plans[0];
      expect(found).toMatchObject({ status: "found", balanceCents: 3_820_000 });
      expect(found.fees).toEqual({ beforeCents: 42_784, afterCents: 1_146, savedCents: 41_638 });
      await expect(answerOldPlan(userId, found.id, true, { client })).rejects.toThrow(
        /already answered/,
      );

      // The tap starts a direct rollover: nothing arrives yet.
      const started = await startRollover(userId, found.id, { client, now: LINKED });
      expect(started.arrivesOn).toBe("2026-10-21");
      const rolling = (await loadOldAccounts(userId, { client, now: LINKED })).plans[0];
      expect(rolling.steps.map((s) => s.doneOn)).toEqual(["2026-10-18", "2026-10-18", null, null]);
      expect(await client.brokerageOrder.count({ where: { userId, reason: "rollover" } })).toBe(0);

      // Three days later the money lands in the IRA, invested; it is a transfer.
      const later = new Date("2026-10-21T15:00:00Z");
      expect(await settleRollovers(userId, { client, now: later })).toBe(1);
      expect(await settleRollovers(userId, { client, now: later })).toBe(0);
      const rolled = (await loadOldAccounts(userId, { client, now: later })).plans[0];
      expect(rolled.status).toBe("rolled");
      const txs = await client.investmentTransaction.findMany({
        where: { userId, name: "ROLLOVER FROM PRIOR EMPLOYER PLAN" },
        select: { subtype: true, amountCents: true },
      });
      expect(txs).toEqual([{ subtype: "transfer", amountCents: -3_820_000 }]);
      // Neither a withdrawal nor a contribution against this year's limits.
      expect(
        await client.investmentTransaction.count({ where: { userId, subtype: "withdrawal" } }),
      ).toBe(0);
      const limits = (await loadRetirementAccounts(userId, { client, now: later })).limits;
      expect(limits.find((l) => l.key === "ira")!.usedCents).toBe(0);
    },
  );

  it(
    "step 211: 401(k)s already linked from past jobs show with the old-accounts suggestion's figures",
    SLOW,
    async () => {
      const user = await client.user.create({
        data: { email: `inv-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: LINKED, person: "preretire" });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
      const view = await loadOldAccounts(user.id, { client, now: LINKED });
      expect(view.linked?.plans.map((p) => p.name)).toEqual(["Former Employer 401(k)"]);
      // The same rule and rate as the suggestion ("$23,892.00 sits in the old ones", "$119").
      const suggestion = runHarness()
        .find((r) => r.person.id === "preretire")!
        .fired.find((s) => s.topic === "old_accounts")!;
      expect(suggestion.short).toContain(formatCents(view.linked!.totalCents));
      expect(suggestion.worthCents).toBe(view.linked!.savedCents);
    },
  );

  it(
    "step 211: the stand-in past employer is the original demo bank's, not a sample person's",
    SLOW,
    async () => {
      const user = await client.user.create({
        data: { email: `inv-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: LINKED, person: "retiree" });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
      expect((await loadOldAccounts(user.id, { client, now: LINKED })).plans).toEqual([]);
    },
  );

  it(
    "step 212: Social Security from pay then from the statement, minimums, the order to draw, how long it lasts",
    SLOW,
    async () => {
      const userId = await demoPerson();
      await saveProfileForm(
        userId,
        { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
        { client, now: LINKED },
      );
      const est = await loadRetirementIncome(userId, { client, now: LINKED });
      // Pay is $81,600: the estimate, labelled as one.
      expect(est.ss).toMatchObject({ source: "estimate", fullMonthlyCents: 292_188 });
      expect(est.ss.options.map((o) => o.age)).toEqual([62, 67, 70]);
      expect(est.balances.preTaxCents).toBeGreaterThan(0);
      expect(est.draw.map((d) => d.key)).toEqual(["taxableCents", "preTaxCents"]);
      expect(est.spendFrom).toBe("pay");
      expect(est.applies).toBe(false);
      // The paycheck always says how long the money lasts.
      expect(est.paycheck!.lasts.lowAge).toBeLessThanOrEqual(est.paycheck!.lasts.highAge);

      await saveRetirementIncome(
        userId,
        { ssMonthly: "3,100", retireAge: "62", ssStartAge: "67", spendMonthly: "4000" },
        { client },
      );
      const saved = await loadRetirementIncome(userId, { client, now: LINKED });
      expect(saved.ss).toMatchObject({
        source: "statement",
        fullMonthlyCents: 310_000,
        startAge: 67,
      });
      expect(saved).toMatchObject({ retireAge: 62, spendMonthlyCents: 400_000, spendFrom: "you" });
      await expect(
        saveRetirementIncome(
          userId,
          { ssMonthly: "", retireAge: "20", ssStartAge: "", spendMonthly: "" },
          { client },
        ),
      ).rejects.toThrow(RetirementIncomeError);
      const { reply } = await sendToJane(userId, "when should I claim social security", {
        client,
        now: LINKED,
      });
      expect(reply.body).toMatch(/\$2,170\.00 a month if you start at 62, \$3,100\.00 at 67/);
    },
  );

  it(
    "step 213: a child's accounts, a Roth limited by earnings, and a gift link that shows only the goal",
    SLOW,
    async () => {
      const userId = await demoPerson();
      await addChild(userId, { name: "Sam", age: 15, earnedCents: 300_000 }, { client });
      await startCollegePlan(
        userId,
        { childName: "Sam", childAge: 15, type: "public" },
        { client, now: LINKED },
      );
      const before = await loadFamily(userId, { client, now: LINKED });
      expect(before.children[0]).toMatchObject({
        name: "Sam",
        custodial: null,
        roth: null,
        gift: null,
      });

      await openChildAccount(userId, "custodial", { client, now: LINKED });
      await openChildAccount(userId, "child_roth", { client, now: LINKED });
      const kid = (await loadFamily(userId, { client, now: LINKED })).children[0];
      expect(kid.roth!.roomCents).toBe(300_000);
      // The Roth is limited by what Sam earned; the custodial account isn't.
      await expect(
        contributeForChild(userId, kid.id, "child_roth", 300_001, { client, now: LINKED }),
      ).rejects.toThrow(/more than they can/);
      await contributeForChild(userId, kid.id, "child_roth", 100_000, { client, now: LINKED });
      await contributeForChild(userId, kid.id, "custodial", 50_000, { client, now: LINKED });
      const after = (await loadFamily(userId, { client, now: LINKED })).children[0];
      expect(after.roth).toMatchObject({ usedCents: 100_000, roomCents: 200_000 });
      expect(after.custodial!.balanceCents).toBe(50_000);

      // A gift link: the public page has the goal and a percent, and nothing of the family's.
      const token = await createGiftLink(userId, kid.college!.planId, { client });
      const page = await giftPage(token, { client });
      expect(Object.keys(page!).sort()).toEqual([
        "childName",
        "goalName",
        "percent",
        "targetCents",
      ]);
      expect(page!.goalName).toBe("College for Sam");
      expect(page!.percent).toBe(0);
      expect(JSON.stringify(page)).not.toMatch(new RegExp(userId));
      await giveGift(token, { giverName: "Grandma", amountCents: 500_000 }, { client });
      await expect(
        giveGift(token, { giverName: "Grandma", amountCents: 2_000_000 }, { client }),
      ).rejects.toThrow(FamilyError);
      await expect(
        giveGift("nope-not-a-token-xx", { giverName: "x", amountCents: 1000 }, { client }),
      ).rejects.toThrow(/isn't taking gifts/);
      const funded = (await loadFamily(userId, { client, now: LINKED })).children[0];
      expect(funded.gift!.gifts).toEqual([{ giverName: "Grandma", amountCents: 500_000 }]);
      expect(funded.college!.savedCents).toBe(500_000);
      expect((await giftPage(token, { client }))!.percent).toBeGreaterThan(0);
      // Taken down, the link stops working.
      expect(await revokeGiftLinks(userId, { client })).toBe(1);
      expect(await giftPage(token, { client })).toBeNull();
    },
  );

  it(
    "step 214: a rental's figures match its transactions, depreciation goes to the taxes side",
    SLOW,
    async () => {
      const userId = await demoPerson();
      await linkDemoRental(userId, { client, now: LINKED });
      await linkDemoRental(userId, { client, now: LINKED });
      // The home, with its mortgage from the demo bank, as the person adds it under Things you own.
      const mortgage = await client.account.findFirstOrThrow({
        where: { userId, subtype: "mortgage" },
      });
      await client.ownedAsset.create({
        data: {
          userId,
          kind: "home",
          name: "Home",
          valueCents: 45_000_000,
          valuedOn: new Date("2026-09-01T00:00:00Z"),
          loanAccountId: mortgage.id,
        },
      });
      const view = await loadProperty(userId, { client, now: LINKED });
      expect(view.rentals).toHaveLength(1);
      const r = view.rentals[0];
      // Re-add the same sums straight from the transactions.
      const txs = await client.transaction.findMany({
        where: { userId, plaidTransactionId: { startsWith: "demo-rental-" } },
      });
      const sum = (needle: string, sign: number) =>
        txs
          .filter((t) => t.description.includes(needle))
          .reduce((s, t) => s + sign * t.amountCents, 0);
      expect(r.counts.rent).toBe(12);
      expect(r.figures.rentCents).toBe(sum("TENANT RENT", -1));
      expect(r.figures.rentCents).toBe(12 * 185_000);
      expect(r.figures.mortgagePaidCents).toBe(sum("MAPLE ST RENTAL LOAN", 1));
      expect(r.figures.propertyTaxCents).toBe(sum("COUNTY TREASURER", 1));
      expect(r.figures.otherExpensesCents).toBe(sum("REPAIR", 1) + sum("LANDLORD INSURANCE", 1));
      expect(r.figures.cashFlowCents).toBe(
        r.figures.rentCents -
          r.figures.mortgagePaidCents -
          r.figures.propertyTaxCents -
          r.figures.otherExpensesCents,
      );
      // Depreciation is step 173's: $208,000 building, 3.636% in 2026.
      expect(r.figures.depreciationCents).toBe(756_288);
      // Both sides of the paydown question, from the demo mortgage.
      expect(view.homes.find((h) => h.valueCents === 45_000_000)!.equityCents).toBe(
        45_000_000 - (mortgage.currentBalanceCents ?? 0),
      );
      expect(view.paydown!.paydown.interestSavedCents).toBeGreaterThan(0);
      expect(view.paydown!.invest.highGainCents).toBeGreaterThan(view.paydown!.invest.lowGainCents);
      // The form checks what it takes.
      await expect(
        addRental(
          userId,
          {
            name: "X",
            purchase: "100000",
            placedInServiceMonth: "13",
            placedInServiceYear: "2020",
            cashInvested: "",
            loanBalance: "",
            loanRate: "",
            monthlyPayment: "",
            rentMatch: "RENT",
            mortgageMatch: "",
            taxMatch: "",
            expenseMatch: "",
          },
          { client },
        ),
      ).rejects.toThrow(PropertyError);
    },
  );

  it(
    "step 215: a premium found in payments asked once, annuity and whole life in dollars with surrender charges, advisory fees",
    SLOW,
    async () => {
      const userId = await demoPerson();
      // The advisory fees in the demo bank's brokerage are read from its fee transactions.
      const none = await loadCostlyProducts(userId, { client, now: LINKED });
      expect(none.advisory!.yearlyCents).toBeGreaterThan(0);
      expect(none.advisory!.gap.highCents).toBeGreaterThan(none.advisory!.gap.lowCents);

      // A life insurer's premiums in the checking account are asked about once.
      const checking = await client.account.findFirstOrThrow({
        where: { userId, subtype: "checking" },
      });
      await client.transaction.create({
        data: {
          userId,
          accountId: checking.id,
          source: "plaid",
          plaidTransactionId: `test-wl-${userId}`,
          date: new Date("2026-09-01T00:00:00Z"),
          amountCents: 600_000,
          description: "NORTHWESTERN MUTUAL LIFE INS PREMIUM",
          pfcPrimary: "GENERAL_SERVICES",
          pfcDetailed: "GENERAL_SERVICES_INSURANCE",
          categorySource: "plaid",
          pending: false,
        },
      });
      const asked = await loadCostlyProducts(userId, { client, now: LINKED });
      expect(asked.asked).toMatchObject([
        { provider: "NORTHWESTERN MUTUAL", yearlyCents: 600_000 },
      ]);
      expect((await loadCostlyProducts(userId, { client, now: LINKED })).asked).toHaveLength(1);
      await answerPremium(userId, asked.asked[0].id, false, { client });
      expect((await loadCostlyProducts(userId, { client, now: LINKED })).asked).toEqual([]);
      await expect(answerPremium(userId, asked.asked[0].id, false, { client })).rejects.toThrow(
        /already answered/,
      );

      // The demo annuity and whole life, with every exit figure carrying its surrender charge.
      await linkDemoProducts(userId, { client, now: LINKED });
      const v = await loadCostlyProducts(userId, { client, now: LINKED });
      const annuity = v.products.find((p) => p.kind === "annuity")!;
      expect(annuity.yearlyCostCents).toBe(216_750);
      expect(annuity.surrender!.pctNow).toBe(4);
      expect(annuity.surrender!.cents).toBe(340_000);
      expect(annuity.surrender!.endsOn).toBe("2030-10-01");
      expect(annuity.exit!.surrenderNowCents).toBe(340_000);
      expect(annuity.gap!.highCents).toBeGreaterThan(annuity.gap!.lowCents);
      const whole = v.products.find((p) => p.kind === "whole_life")!;
      expect(whole.wholeLife!.paidCents).toBe(6 * 600_000);
      // The form checks what it takes.
      await expect(
        saveProduct(
          userId,
          {
            kind: "annuity",
            name: "X",
            provider: "Y",
            value: "1000",
            feePercent: "2",
            premiumYearly: "",
            purchasedYear: "2020",
            purchasedMonth: "1",
            schedule: "7,abc",
          },
          { client, now: LINKED },
        ),
      ).rejects.toThrow(CostlyProductError);
    },
  );

  it(
    "step 216: one yearly review message with every item's button; nothing happens until a tap",
    SLOW,
    async () => {
      const userId = await demoPerson();
      await saveProfileForm(
        userId,
        { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
        { client, now: LINKED },
      );
      const ordersBefore = await client.brokerageOrder.count({ where: { userId } });
      const snapshot = await loadSnapshot(userId, { client, now: LINKED });
      const review = investmentsSource
        .gather(snapshot!, {} as never)
        .find((c) => c.dedupeKey === "review:2026")!;
      expect(review).toBeTruthy();
      expect(review.body).toMatch(/^Your 2026 investing review, all in one place:/);
      // Items the demo person has: the match left on the table, a drifted mix, the goals.
      expect(review.actions.map((a) => a.id)).toEqual(
        expect.arrayContaining(["retire.match", "invest.rebalance"]),
      );
      // Reading and gathering it moved nothing.
      expect(await client.brokerageOrder.count({ where: { userId } })).toBe(ordersBefore);
      expect(await client.payrollChange.count({ where: { userId } })).toBe(0);

      // One of its buttons works as it does anywhere: the match raise, through the stand-in.
      const posted = await client.janeMessage.create({
        data: {
          userId,
          kind: review.kind,
          body: review.body,
          refs: review.refs,
          actions: review.actions,
          dedupeKey: "test:review",
        },
      });
      await takeChatAction(userId, posted.id, "retire.match", { client, now: LINKED });
      expect(await client.payrollChange.count({ where: { userId } })).toBe(1);

      // The harvest button only acts on the list it showed.
      const extras = await loadReviewExtras(userId, { client, now: LINKED });
      await expect(
        harvestFromReview(userId, "not-the-key", { client, now: LINKED }),
      ).rejects.toThrow(ReviewError);
      expect(extras.raise).toBe(false);
    },
  );

  it(
    "step 231: swaps leave the overall mix the same, and only the plan the person saw is acted on",
    SLOW,
    async () => {
      const userId = await demoPerson();
      const before = await loadLocation(userId, { client, now: LINKED });
      const plan = before.plan!;
      expect(plan).toBeTruthy();
      await expect(makeSwaps(userId, "stale", "free", { client, now: LINKED })).rejects.toThrow(
        LocationError,
      );
      expect(
        await client.brokerageOrder.count({ where: { userId, reason: "asset_location" } }),
      ).toBe(0);
      const free = plan.swaps.filter((s) => s.taxCents === 0);
      if (free.length > 0) {
        await makeSwaps(userId, plan.key, "free", { client, now: LINKED });
        const after = await loadLocation(userId, { client, now: LINKED });
        // The overall mix is the same to the cent after the swaps.
        for (const c of ["bonds", "us_stocks", "intl_stocks"] as const) {
          expect(after.plan!.totals[c]).toBe(plan.totals[c]);
        }
        expect(
          await client.brokerageOrder.count({ where: { userId, reason: "asset_location" } }),
        ).toBeGreaterThan(0);
      } else {
        await expect(makeSwaps(userId, plan.key, "free", { client, now: LINKED })).rejects.toThrow(
          /nothing to swap/,
        );
      }
    },
  );

  it(
    "step 232: the menu is read, confirmed, and only then used; only its funds are suggested; the saving is in dollars",
    SLOW,
    async () => {
      const userId = await demoPerson();
      await saveProfileForm(
        userId,
        { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
        { client, now: LINKED },
      );
      await expect(
        proposeMenu(userId, "nothing useful here", "you", { client, now: LINKED }),
      ).rejects.toThrow(PlanMenuError);
      const read = await proposeMenu(userId, sampleDisclosure(), "demo", { client, now: LINKED });
      expect(read.funds.map((f) => f.ticker)).toEqual([
        "NSTDX",
        "KTRGX",
        "SLGFX",
        "KTSIX",
        "KTIIX",
        "KTBIX",
        "DSVXX",
      ]);
      // Not confirmed: nothing suggested, and a change is refused.
      const before = await loadPlanMenu(userId, { client, now: LINKED });
      expect(before.proposed!.id).toBe(read.id);
      expect(before.plan).toBeNull();
      await expect(requestPlanChange(userId, { client, now: LINKED })).rejects.toThrow(
        /Confirm your plan's fund list/,
      );

      // Confirmed through the chat button.
      const snapshot = await loadSnapshot(userId, { client, now: LINKED });
      const ask = investmentsSource
        .gather(snapshot!, {} as never)
        .find((c) => c.dedupeKey.startsWith("menu:confirm:"))!;
      const posted = await client.janeMessage.create({
        data: {
          userId,
          kind: ask.kind,
          body: ask.body,
          refs: ask.refs,
          actions: ask.actions,
          dedupeKey: "test:menu",
        },
      });
      await takeChatAction(userId, posted.id, "menu.confirm", { client, now: LINKED });
      await expect(confirmMenu(userId, read.id, { client })).rejects.toThrow(PlanMenuError);

      const view = await loadPlanMenu(userId, { client, now: LINKED });
      const plan = view.plan!;
      const onMenu = new Set(view.menu!.funds.map((f) => f.ticker));
      expect(plan.suggested.every((a) => onMenu.has(a.ticker))).toBe(true);
      expect(plan.suggestedBps).toBeLessThan(plan.currentBps);
      expect(plan.savingCents).toBe(
        Math.round((plan.balanceCents * (plan.currentBps - plan.suggestedBps)) / 10_000),
      );
      expect(plan.savingCents).toBeGreaterThan(0);
      expect(plan.targetDates[0]!.savingCents).toBeGreaterThan(0);

      // The change goes to the payroll stand-in once.
      const r = await requestPlanChange(userId, { client, now: LINKED });
      expect(r.savingCents).toBe(plan.savingCents);
      expect(await client.planChange.count({ where: { userId } })).toBe(1);
      await expect(requestPlanChange(userId, { client, now: LINKED })).rejects.toThrow(
        /already requested/,
      );
    },
  );

  it(
    "step 233: 1, 3 and 5 years after fees and taxes against a benchmark, the reasons adding up",
    SLOW,
    async () => {
      const userId = await demoPerson();
      await saveProfileForm(
        userId,
        { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
        { client, now: LINKED },
      );
      const v = await loadHonest(userId, { client, now: LINKED });
      expect(v.rows.map((r) => r.key)).toEqual(["1y", "3y", "5y"]);
      for (const r of v.rows) {
        // After fees and taxes can only be at or below before; the reasons add up to the gap.
        expect(r.afterTaxes).toBeLessThanOrEqual(r.beforeFees);
        expect(r.reasons.reduce((s, x) => s + x.points, 0)).toBeCloseTo(r.gap, 10);
        expect(r.from < r.to).toBe(true);
      }
      const { reply } = await sendToJane(userId, "am i beating the market", {
        client,
        now: LINKED,
      });
      expect(reply.body).toMatch(/Over 1 year: /);
      expect(reply.body).toMatch(/Over 5 years/);
    },
  );

  it(
    "step 234: a goal's money compared after tax, a ladder that never runs past the date and rolls itself over",
    SLOW,
    async () => {
      const userId = await demoPerson();
      await client.savingsGoal.create({
        data: {
          userId,
          name: "House down payment",
          targetCents: 3_000_000,
          targetDate: new Date("2027-10-18T00:00:00Z"),
          manualSavedCents: 2_000_000,
        },
      });
      // A goal five years out isn't short-term.
      await client.savingsGoal.create({
        data: {
          userId,
          name: "Retirement trip",
          targetCents: 3_000_000,
          targetDate: new Date("2031-10-18T00:00:00Z"),
          manualSavedCents: 500_000,
        },
      });
      const view = await loadShortTerm(userId, { client, now: LINKED });
      expect(view.candidates.map((c) => c.name)).not.toContain("Retirement trip");
      const goal = view.candidates.find((c) => c.name === "House down payment")!;
      expect(goal.months).toBe(12);
      // Only places that can't lock the money past the date.
      expect(goal.options.every((o) => o.product.lockMonths <= 12)).toBe(true);
      expect(goal.options.map((o) => o.afterTaxBps)).toEqual(
        [...goal.options.map((o) => o.afterTaxBps)].sort((a, b) => b - a),
      );

      await expect(startLadder(userId, "goal:nope", { client, now: LINKED })).rejects.toThrow(
        ShortTermError,
      );
      if (goal.ladder) {
        await startLadder(userId, goal.key, { client, now: LINKED });
        await expect(startLadder(userId, goal.key, { client, now: LINKED })).rejects.toThrow(
          /already has a ladder/,
        );
        const row = await client.billLadder.findFirstOrThrow({ where: { userId } });
        // Nothing matures after the goal date.
        const rungs = row.rungs as unknown as { bills: { endMonth: number }[] }[];
        expect(rungs.every((r) => r.bills.every((b) => b.endMonth <= 12))).toBe(true);
        // Six months later the short bills have rolled; a year later it's cash again.
        const mid = new Date("2027-04-19T12:00:00Z");
        const rolled = await settleLadders(userId, { client, now: mid });
        expect(rolled).toBeGreaterThan(0);
        expect(await settleLadders(userId, { client, now: mid })).toBe(0);
        await settleLadders(userId, { client, now: new Date("2027-10-19T12:00:00Z") });
        expect((await client.billLadder.findFirstOrThrow({ where: { userId } })).status).toBe(
          "closed",
        );
      }
    },
  );

  it(
    "step 235: a big deposit is asked about once, tax comes first, and each stage waits for a tap",
    SLOW,
    async () => {
      const userId = await demoPerson();
      await addDemoDeposit(userId, { client, now: LINKED });
      const first = await loadSuddenMoney(userId, { client, now: LINKED });
      expect(first.items).toHaveLength(1);
      expect(first.items[0].status).toBe("asked");
      // Asked once: loading again doesn't ask again.
      expect((await loadSuddenMoney(userId, { client, now: LINKED })).items).toHaveLength(1);
      const id = first.items[0].id;
      await classify(userId, id, "bonus", { client });
      await expect(classify(userId, id, "gift", { client })).rejects.toThrow(SuddenMoneyError);

      const planned = (await loadSuddenMoney(userId, { client, now: LINKED })).items[0];
      // Tax comes first whenever there is any to set aside (a bonus at or under 22% has none).
      expect(planned.tax).not.toBeNull();
      if (planned.tax!.cents > 0) expect(planned.stages[0].key).toBe("taxes");
      expect(planned.stages.length).toBeGreaterThan(1);
      expect(planned.stages.every((s) => !s.done)).toBe(true);
      // Out of order is refused; nothing has moved without a tap.
      const last = planned.stages[planned.stages.length - 1].key;
      await expect(doStage(userId, id, last, { client, now: LINKED })).rejects.toThrow(
        SuddenMoneyError,
      );
      const firstKey = planned.stages[0].key;
      const done = await doStage(userId, id, firstKey, { client, now: LINKED });
      expect(done.stage).toBe(firstKey);
      await expect(doStage(userId, id, firstKey, { client, now: LINKED })).rejects.toThrow(
        SuddenMoneyError,
      );
      const after = (await loadSuddenMoney(userId, { client, now: LINKED })).items[0];
      expect(after.stages[0].done).toBe(true);

      const { reply } = await sendToJane(userId, "what should i do with my bonus", {
        client,
        now: LINKED,
      });
      expect(reply.body).toMatch(/Nothing moves until you tap|All done/);
    },
  );

  it(
    "step 236: a values list switches funds inside each kind, keeps the risk target, and steers the rebalance",
    SLOW,
    async () => {
      const userId = await demoPerson();
      const before = await loadValues(userId, { client, now: LINKED });
      expect(before.plan?.switches).toEqual([]);
      await savePrefs(
        userId,
        { excludes: ["fossil_fuels", "weapons", "tobacco", "bogus"], themes: [] },
        { client },
      );
      const view = await loadValues(userId, { client, now: LINKED });
      expect(view.prefs.excludes).toEqual(["fossil_fuels", "weapons", "tobacco"]);
      const plan = view.plan!;
      expect(plan.switches.length).toBeGreaterThan(0);
      for (const cls of ["us_stocks", "intl_stocks", "bonds"] as const) {
        expect(plan.classTotals[cls].before).toBe(plan.classTotals[cls].after);
      }
      await expect(applyValues(userId, "stale", { client, now: LINKED })).rejects.toThrow(
        ValuesError,
      );
      const done = await applyValues(userId, plan.key, { client, now: LINKED });
      expect(done.switches).toBe(plan.switches.length);
      const after = await loadValues(userId, { client, now: LINKED });
      expect(after.plan?.switches).toEqual([]);
    },
  );

  it(
    "step 237: beneficiaries missing or out of date, a family file with only what is picked, no legal advice",
    SLOW,
    async () => {
      const userId = await demoPerson();
      const first = await loadFamilyFile(userId, { client });
      const k = first.checks.find((c) => c.problems.includes("missing"))!;
      expect(k).toBeDefined();
      await expect(
        saveBeneficiaries(
          userId,
          k.accountId,
          [{ name: "Sam", relationship: "spouse", sharePct: 60, tier: "primary" }],
          { client, now: LINKED },
        ),
      ).rejects.toThrow(FamilyFileError);
      await saveBeneficiaries(
        userId,
        k.accountId,
        [{ name: "Sam", relationship: "spouse", sharePct: 100, tier: "primary" }],
        { client, now: LINKED },
      );
      let view = await loadFamilyFile(userId, { client });
      expect(view.checks.find((c) => c.accountId === k.accountId)!.problems).toEqual([]);
      // A birth after the names were confirmed makes them out of date; a tap confirms them.
      await recordEvent(userId, "birth", "2099-01-01", { client });
      view = await loadFamilyFile(userId, { client });
      expect(view.checks.find((c) => c.accountId === k.accountId)!.problems).toEqual([
        "out_of_date",
      ]);
      await expect(recordEvent(userId, "wedding", "2099-01-01", { client })).rejects.toThrow(
        FamilyFileError,
      );
      await confirmBeneficiaries(userId, k.accountId, {
        client,
        now: new Date("2099-02-01T12:00:00Z"),
      });
      view = await loadFamilyFile(userId, { client });
      expect(view.checks.find((c) => c.accountId === k.accountId)!.problems).toEqual([]);

      // The file holds only what is picked.
      await saveContacts(
        userId,
        [{ name: "Pat Lee", role: "lawyer", phone: "555-0100", email: null }],
        "Hall closet",
        { client },
      );
      await savePicks(userId, ["contacts", "bogus"], { client });
      const text = await exportFamilyFile(userId, { client, now: LINKED });
      expect(text).toMatch(/Pat Lee \(lawyer\)/);
      expect(text).not.toMatch(/Hall closet|nobody named|Sam/);
      const { reply } = await sendToJane(userId, "do i need a will", { client, now: LINKED });
      expect(reply.body).toMatch(/estate-planning attorney/);
      expect(reply.body).not.toMatch(/you should/i);
    },
  );
});
