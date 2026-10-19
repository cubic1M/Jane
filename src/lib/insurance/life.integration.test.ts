import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import {
  LifeError,
  answerLifeQuestion,
  buyLife,
  dismissLife,
  latestLife,
  saveDependants,
  sizeLife,
  startLifeApplication,
  submitLifeApplication,
} from "./life";
import { nextLifeQuestion } from "./life-underwriting";
import { listPolicies } from "./policies";

// Life insurance, sized and bought, against a real, migrated Postgres (spec step 153): the
// amount from the person's own accounts with the method, term quotes from the partner
// stand-in, the health questions one at a time, the carrier's decision, and the policy
// once they buy. Demo advice only; nothing is applied for or bought without a tap.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");
const DAY = 86_400_000;

describe.runIf(url)("life insurance, sized and bought, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const opts = () => ({ client, now: NOW });

  // A demo-bank person: paid $4,000 every two weeks, a $300,000 mortgage until 2046 and
  // $20,000 in savings.
  async function person(demo = true) {
    const user = await client.user.create({
      data: { email: `ins-life-${crypto.randomUUID()}@example.com`, name: "Sam Lee" },
    });
    created.push(user.id);
    const item = demo
      ? await client.plaidItem.create({
          data: {
            userId: user.id,
            plaidItemId: `demo-${crypto.randomUUID()}`,
            accessTokenEncrypted: "v1:unused",
          },
        })
      : null;
    const account = (name: string, type: string, subtype: string, balance: number) =>
      client.account.create({
        data: {
          userId: user.id,
          itemId: item?.id ?? null,
          source: demo ? "plaid" : "csv",
          name,
          type,
          subtype,
          currentBalanceCents: balance,
        },
      });
    const checking = await account("Checking", "depository", "checking", 500_000);
    await account("Savings", "depository", "savings", 1_500_000);
    const mortgage = await account("Mortgage", "loan", "mortgage", 30_000_000);
    await client.liability.create({
      data: {
        userId: user.id,
        accountId: mortgage.id,
        kind: "mortgage",
        payoffDate: new Date("2046-06-01T00:00:00Z"),
      },
    });
    for (let i = 0; i < 6; i += 1) {
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: checking.id,
          source: demo ? "plaid" : "csv",
          date: new Date(NOW.getTime() - (5 + 14 * i) * DAY),
          amountCents: -400_000,
          description: "ACME CORP PAYROLL",
          pfcPrimary: "INCOME",
          pfcDetailed: "INCOME_SALARY",
        },
      });
    }
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("sizes the cover from the accounts, with the method and term quotes", async () => {
    const me = await person();
    expect(await sizeLife(me, opts())).toEqual({ kind: "ask_dependants" });
    await saveDependants(me, 2, opts());
    const sized = await sizeLife(me, opts());
    expect(sized.kind).toBe("sized");
    const application = (sized as { application: Awaited<ReturnType<typeof latestLife>> })
      .application!;
    // $2,400,000 × 365 / 90 ≈ $97,333 a year of pay.
    expect(application.method.map((l) => [l.label, l.cents, l.adds])).toEqual([
      ["10 years of your pay", 97_333_330, true],
      ["Paying off the mortgage", 30_000_000, true],
      ["Final expenses", 1_500_000, true],
      ["School for 2 dependants", 10_000_000, true],
      ["Less your savings", 2_000_000, false],
    ]);
    expect(application).toMatchObject({
      status: "sized",
      amountCents: 140_000_000,
      termYears: 20,
    });
    expect(application.quotes.length).toBeGreaterThan(0);
    expect(application.quotes[0].demo).toBe(true);
    // Sized again with the same numbers: the same application, nothing applied for.
    const again = await sizeLife(me, opts());
    expect(again).toMatchObject({ kind: "sized", application: { id: application.id } });
    expect(await listPolicies(me, opts())).toEqual([]);
  });

  it("applies only on a tap, asks the questions, and buys only on another", async () => {
    const me = await person();
    await saveDependants(me, 1, opts());
    const { application } = (await sizeLife(me, opts())) as {
      application: NonNullable<Awaited<ReturnType<typeof latestLife>>>;
    };
    await expect(submitLifeApplication(me, application.id, opts())).rejects.toThrow(LifeError);
    let current = await startLifeApplication(me, application.id, null, opts());
    expect(current).toMatchObject({
      status: "asking",
      quoteId: application.quotes[0].partnerQuoteId,
    });
    await expect(submitLifeApplication(me, application.id, opts())).rejects.toThrow(
      "There are still questions to answer.",
    );
    for (
      let key = nextLifeQuestion(current.answers);
      key;
      key = nextLifeQuestion(current.answers)
    ) {
      current = await answerLifeQuestion(me, application.id, key, key === "tobacco", opts());
    }
    const sent = await submitLifeApplication(me, application.id, opts());
    expect(sent.decision).toMatchObject({
      outcome: "offered",
      rateClass: "tobacco",
      premiumCents: Math.round((application.quotes[0].premiumCents * 2.5) / 100) * 100,
    });
    // Health answers are never logged.
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: me },
      "life_application_submitted",
      { type: "life_application", id: application.id },
      { carrier: application.quotes[0].carrier.id, outcome: "offered" },
    );
    expect(await listPolicies(me, opts())).toEqual([]);

    const policyId = await buyLife(me, application.id, opts());
    const [policy] = await listPolicies(me, opts());
    expect(policy).toMatchObject({
      id: policyId,
      kind: "life",
      status: "active",
      source: "switch",
      premiumCents: sent.decision!.outcome === "offered" ? sent.decision!.premiumCents : 0,
      coverage: { deathBenefit: application.amountCents, termYears: application.termYears },
    });
    await expect(buyLife(me, application.id, opts())).rejects.toThrow(LifeError);
    // Covered now: nothing more to suggest.
    expect(await sizeLife(me, opts())).toMatchObject({ kind: "in_progress" });
  });

  it("refers health history for the carrier's review, and leaves a Not now alone", async () => {
    const me = await person();
    await saveDependants(me, 2, opts());
    const first = (await sizeLife(me, opts())) as { application: { id: string } };
    await startLifeApplication(me, first.application.id, null, opts());
    let current = await answerLifeQuestion(me, first.application.id, "conditions", true, opts());
    for (
      let key = nextLifeQuestion(current.answers);
      key;
      key = nextLifeQuestion(current.answers)
    ) {
      current = await answerLifeQuestion(me, first.application.id, key, false, opts());
    }
    const sent = await submitLifeApplication(me, first.application.id, opts());
    expect(sent).toMatchObject({ status: "referred", decision: { outcome: "referred" } });
    await expect(buyLife(me, first.application.id, opts())).rejects.toThrow(LifeError);

    await dismissLife(me, first.application.id, opts());
    expect(await sizeLife(me, opts())).toEqual({ kind: "dismissed" });
    // Asked for in so many words, it's offered again.
    expect((await sizeLife(me, { ...opts(), asked: true })).kind).toBe("sized");
  });

  it("gives real accounts no amount", async () => {
    const me = await person(false);
    await saveDependants(me, 2, opts());
    expect(await sizeLife(me, opts())).toEqual({ kind: "no_advice" });
    const { reply } = await sendToJane(me, "how much life insurance do I need", opts());
    expect(reply.body).toMatch(/^I can't tell you how much life insurance to get/);
    expect(reply.refs.advice).toBeUndefined();
  });

  it("does it all in one chat message, a tap at a time", async () => {
    const me = await person();
    await client.insurancePolicy.create({
      data: { userId: me, kind: "auto", carrier: "GEICO", source: "typed", status: "active" },
    });
    const run = (days: number) =>
      runJaneAgent(me, { client, now: new Date(NOW.getTime() + days * DAY), trigger: "open" });
    let message;
    for (let day = 0; day < 10 && !message; day += 1) {
      await run(day);
      message = (await client.janeMessage.findMany({ where: { userId: me } })).find((m) =>
        m.dedupeKey.includes("life-dependants"),
      );
    }
    expect(message?.body).toMatch(/^One question so I can check your life cover/);
    const tap = async (id: Parameters<typeof takeChatAction>[2]) =>
      (await takeChatAction(me, message!.id, id, opts())).message;

    let now = await tap("lifecover.dependants_2");
    expect(now.status).toBe("open");
    expect(now.body).toMatch(
      /^You'd need about \$1,400,000\.00 of term life insurance for 20 years\./,
    );
    expect(parseRefs(now.refs)).toMatchObject({ advice: true });
    expect(parseActions(now.actions).map((a) => a.id)).toEqual([
      "lifecover.apply",
      "open",
      "lifecover.dismiss",
    ]);
    now = await tap("lifecover.apply");
    expect(now.body).toMatch(/^Question 1 of 5:/);
    for (let i = 0; i < 5; i += 1) now = await tap("lifecover.no");
    expect(now.body).toMatch(/^That's every question\./);
    now = await tap("lifecover.submit");
    expect(now.body).toMatch(
      /offers you \$1,400,000\.00 of cover for 20 years at .* their best rate\. Buy it\?/,
    );
    now = await tap("lifecover.buy");
    expect(now).toMatchObject({ status: "answered", answeredWith: "Buy it" });
    expect((await listPolicies(me, opts())).map((p) => p.kind).sort()).toEqual(["auto", "life"]);

    const { reply } = await sendToJane(me, "how much life insurance do I need", opts());
    expect(reply.refs.advice).toBe(true);
    const tool = JSON.parse((await runChatTool(me, "insurance_life", {}, opts())).content);
    expect(tool).toMatchObject({
      available: true,
      demoAdvice: true,
      application: { status: "bought", amount: "$1,400,000.00", termYears: 20 },
    });
  });
});
