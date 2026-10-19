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
import { syncItem } from "@/lib/plaid/sync";
import { profileSummary } from "@/planning/investor-profile";
import { loadFees } from "./fees";
import { loadRetirement } from "./retirement";
import { loadReview } from "./review";
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

  async function demoPerson() {
    const user = await client.user.create({
      data: { email: `inv-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
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
      "Thanks. Your profile: Moderate: you'd worry, but wait it out after a drop, so less risk than your timeline allows. You can change it any time.",
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
    expect(reply.body).toMatch(/^Against your moderate profile/);
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
    // And they stay that way through a full sync of the demo bank.
    const item = await client.plaidItem.findFirstOrThrow({ where: { userId } });
    await syncItem(item.id, { client, api: plaid, now: new Date("2026-10-20T15:00:00Z") });
    expect((await loadRebalance(userId, { client, now: LINKED })).plan!.orders).toEqual([]);
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
});
