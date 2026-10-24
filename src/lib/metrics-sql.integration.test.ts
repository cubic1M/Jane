import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { automateNext, computeMetrics, loadMetricRows } from "./metrics";
import { automateNextSql, computeMetricsSql } from "./metrics-sql";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
// Seeds a small history in 2001 (so other tests' rows don't fall in these windows), then
// checks the SQL metrics equal computeMetrics on the same snapshot of the database.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2001-06-30T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe.runIf(url)("metrics in SQL against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID().slice(0, 8);
  const users: string[] = [];
  let partnerId: string;

  async function person(name: string, createdDaysAgo: number) {
    const user = await client.user.create({
      data: { email: `metrics-${name}-${suffix}@example.com`, createdAt: ago(createdDaysAgo) },
    });
    users.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    partnerId = (
      await client.referralPartner.create({
        data: {
          key: `metrics-${suffix}`,
          name: `Metrics Bank ${suffix}`,
          actionType: "move_idle_cash",
          disclosure: "We may earn a fee.",
          referralUrl: "https://example.com",
        },
      })
    ).id;

    // Ana: signed up and linked 40 days ago; findings, decisions, finished actions.
    const ana = await person("ana", 40);
    await client.account.create({
      data: { userId: ana, source: "csv", name: "Card", type: "credit", createdAt: ago(40) },
    });
    const finding = (type: "bank_fees" | "subscription_review" | "idle_cash", over: object = {}) =>
      client.finding.create({
        data: {
          userId: ana,
          type,
          key: `${type}-${crypto.randomUUID()}`,
          title: type,
          annualSavingsCents: 10_000,
          confidence: "high",
          evidence: {},
          ...over,
        },
      });
    const fees = await finding("bank_fees");
    const sub = await finding("subscription_review", { status: "approved" });
    await finding("idle_cash", { confidence: "low" });
    await finding("subscription_review", { status: "new" });
    for (const [f, days] of [
      [fees, 5],
      [sub, 5],
      [sub, 20],
    ] as const) {
      await client.analyticsEvent.create({
        data: {
          userId: ana,
          name: "card_opened",
          properties: { finding_id: f.id },
          createdAt: ago(days),
        },
      });
    }
    const decide = (
      findingId: string,
      choice: "yes" | "no" | "diy",
      days: number,
      undone = false,
    ) =>
      client.decision.create({
        data: {
          userId: ana,
          findingId,
          choice,
          cardSnapshot: {},
          createdAt: ago(days),
          undoneAt: undone ? ago(days) : null,
        },
      });
    const yes = await decide(sub.id, "yes", 5);
    await decide(fees.id, "no", 4, true);
    const diy = await decide(fees.id, "diy", 3);
    void diy;
    await client.action.create({
      data: {
        userId: ana,
        decisionId: yes.id,
        type: "cancel_subscription",
        status: "done",
        completedAt: ago(2),
        minutesSpent: 15,
        createdAt: ago(5),
      },
    });
    await client.membershipIntent.create({
      data: { userId: ana, kind: "reserve", createdAt: ago(1) },
    });
    // Came back 25 days after linking.
    await client.analyticsEvent.create({
      data: { userId: ana, name: "report_viewed", createdAt: ago(15) },
    });
    await client.referralConversion.create({
      data: { partnerId, userId: ana, amountCents: 4_000, createdAt: ago(6) },
    });

    // Ben: signed up 10 days ago, linked 3 days ago; a failed action and an unlogged one.
    const ben = await person("ben", 10);
    await client.account.create({
      data: { userId: ben, source: "csv", name: "Checking", type: "depository", createdAt: ago(3) },
    });
    const benFinding = await client.finding.create({
      data: {
        userId: ben,
        type: "bank_fees",
        key: `fees-${suffix}`,
        title: "fees",
        annualSavingsCents: 30_000,
        confidence: "medium",
        evidence: {},
        status: "in_progress",
      },
    });
    // Ben saw his in Jane's chat, not on a card page: that counts as shown (gap audit).
    await client.janeMessage.create({
      data: {
        userId: ben,
        kind: "decision",
        body: "Want me to ask for the fees back?",
        refs: { findingId: benFinding.id },
        dedupeKey: `metrics-${suffix}`,
        createdAt: ago(3),
      },
    });
    const benYes = await client.decision.create({
      data: {
        userId: ben,
        findingId: benFinding.id,
        choice: "yes",
        cardSnapshot: {},
        createdAt: ago(3),
      },
    });
    await client.action.create({
      data: {
        userId: ben,
        decisionId: benYes.id,
        type: "recover_bank_fees",
        status: "failed",
        completedAt: ago(1),
        minutesSpent: 40,
        createdAt: ago(3),
      },
    });

    // Cy: signed up 2 days ago, never linked.
    await person("cy", 2);

    // Spec step 138: someone trying Jane with sample data, 3 days ago. Never counted.
    const trial = await client.user.create({
      data: {
        id: `trial_metrics${suffix}`,
        email: `trial_metrics${suffix}@try.jane.invalid`,
        createdAt: ago(3),
      },
    });
    users.push(trial.id);
    await client.account.create({
      data: { userId: trial.id, source: "csv", name: "Card", type: "credit", createdAt: ago(3) },
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.referralPartner.deleteMany({ where: { id: partnerId } });
    await client.$disconnect();
  });

  it("matches computeMetrics for every window, and automate-next", async () => {
    // One consistent snapshot, so tests running alongside can't change the data mid-way.
    await client.$transaction(
      async (tx) => {
        const db = tx as unknown as PrismaClient;
        const rows = await loadMetricRows({ client: db });
        for (const days of [7, 30, 365]) {
          const w = { start: ago(days), end: NOW };
          expect(await computeMetricsSql(db, w), `${days} days`).toEqual(computeMetrics(rows, w));
        }
        expect(await automateNextSql(db)).toEqual(automateNext(rows.actions));
      },
      { isolationLevel: "RepeatableRead", timeout: 60_000 },
    );
  });

  it("finds what the seeded history should give", async () => {
    const m = await computeMetricsSql(client, { start: ago(30), end: NOW });
    // The trial person isn't in it.
    expect(m.linkRate).toEqual({ signedUp: 2, linked: 1, rate: 0.5 });
    expect(m.completion).toEqual({ closed: 2, done: 1, rate: 0.5 });
    // Bank fees: Ana's card opened and Ben's chat message are both shown; her do-it-yourself and
    // his yes are both approvals.
    expect(m.approval.find((a) => a.type === "bank_fees")).toMatchObject({ shown: 2, approved: 2 });
    expect(m.willingnessToPay).toEqual({ completed: 1, willing: 1, rate: 1 });
    expect(m.referrals.byPartner).toEqual([
      { partner: `Metrics Bank ${suffix}`, conversions: 1, cents: 4_000 },
    ]);
    // Ana's 30th day after linking (10 days ago) fell in the window, and she came back on day 25.
    expect(m.retention).toEqual({ cohort: 1, retained: 1, rate: 1 });
  });
});
