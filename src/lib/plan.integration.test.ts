import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
// The concierge flow is what's tested here (the demo bank and trial people get it); read-only
// mode for real accounts is in src/lib/decisions.integration.test.ts.
vi.mock("@/lib/concierge-mode", () => ({ conciergeMode: vi.fn(async () => true) }));

import { track } from "@/lib/analytics";
import { findingOfType } from "./__fixtures__/findings";
import { answerPlanItem, markPlanShown, planFor, yesToAll } from "./plan";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("Jane's plan against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `plan-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }

  async function finding(
    userId: string,
    type: Parameters<typeof findingOfType>[0],
    annualSavingsCents: number | null,
  ) {
    const f = findingOfType(type);
    return client.finding.create({
      data: {
        userId,
        type: f.type,
        key: `${f.key}-${crypto.randomUUID()}`,
        title: f.title,
        annualSavingsCents,
        amountCents: f.amountCents,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonObject,
      },
      select: { id: true },
    });
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("lists open findings, time-sensitive first, then by money", async () => {
    const userId = await person();
    const small = await finding(userId, "bank_fees", 3_500);
    const big = await finding(userId, "idle_cash", 50_000);
    const urgent = await finding(userId, "duplicate_charge", 6_420);
    const other = await person();
    await finding(other, "bank_fees", 99_999);

    const plan = await planFor(userId, { client });
    expect(plan.map((i) => i.card.findingId)).toEqual([urgent.id, big.id, small.id]);
    expect(plan[0]).toMatchObject({ urgent: true });
    expect(plan.find((i) => i.card.findingId === big.id)?.options.map((o) => o.key)).toEqual([
      "keepInChecking",
    ]);

    await markPlanShown(userId, [small.id], { client });
    expect((await client.finding.findUniqueOrThrow({ where: { id: small.id } })).status).toBe(
      "shown",
    );
  });

  it("logs one plan decision per item for Yes to all, and answered items leave the plan", async () => {
    const userId = await person();
    await finding(userId, "bank_fees", 3_500);
    await finding(userId, "card_interest", 34_181);
    const plan = await planFor(userId, { client });

    const results = await yesToAll(
      userId,
      plan.map((i) => ({ findingId: i.card.findingId, cardHash: i.cardHash })),
      { client },
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const decisions = await client.decision.findMany({ where: { userId } });
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d) => d.source === "plan" && d.choice === "yes")).toBe(true);
    expect(await client.action.count({ where: { userId } })).toBe(2);
    expect(await planFor(userId, { client })).toEqual([]);
    expect(track).toHaveBeenCalledWith(userId, "plan_yes_to_all", {
      items: 2,
      approved: 2,
      source: "plan",
    });

    // Asking again doesn't record twice.
    const again = await yesToAll(
      userId,
      plan.map((i) => ({ findingId: i.card.findingId, cardHash: i.cardHash })),
      { client },
    );
    expect(again.every((r) => !r.ok)).toBe(true);
    expect(await client.decision.count({ where: { userId } })).toBe(2);
  });

  it("keeps changed options with the decision, and refuses ones out of range", async () => {
    const userId = await person();
    const sub = await finding(userId, "subscription_review", 21_588);
    const bill = await finding(userId, "bill_negotiation", 54_000);
    const plan = await planFor(userId, { client });
    const item = (id: string) => plan.find((i) => i.card.findingId === id)!;

    const changed = await answerPlanItem(
      userId,
      {
        findingId: sub.id,
        cardHash: item(sub.id).cardHash,
        choice: "yes",
        options: { plan: "downgrade" },
      },
      { client },
    );
    expect(changed.ok).toBe(true);
    const decision = await client.decision.findFirstOrThrow({ where: { findingId: sub.id } });
    expect(decision.options).toEqual({ plan: "downgrade" });

    const refused = await answerPlanItem(
      userId,
      {
        findingId: bill.id,
        cardHash: item(bill.id).cardHash,
        choice: "yes",
        options: { targetMonthly: "-5" },
      },
      { client },
    );
    expect(refused).toMatchObject({ ok: false });
    expect(await client.decision.count({ where: { findingId: bill.id } })).toBe(0);

    // Jane's defaults store no options at all.
    await answerPlanItem(
      userId,
      {
        findingId: bill.id,
        cardHash: item(bill.id).cardHash,
        choice: "yes",
        options: { targetMonthly: "" },
      },
      { client },
    );
    expect(
      (await client.decision.findFirstOrThrow({ where: { findingId: bill.id } })).options,
    ).toBeNull();
  });

  it("ticks what Jane would do, leaving low-confidence items unticked and on the plan", async () => {
    const userId = await person();
    const fee = await finding(userId, "bank_fees", 3_500);
    const trial = await finding(userId, "trial_conversion", 12_000);
    const subscription = await finding(userId, "subscription_review", 21_588);
    await client.finding.update({ where: { id: trial.id }, data: { confidence: "low" } });
    const plan = await planFor(userId, { client });
    const item = (id: string) => plan.find((i) => i.card.findingId === id)!;
    expect(item(fee.id).preselected).toBe(true);
    expect(item(trial.id).preselected).toBe(false);
    // Cancelling something they may still use is never ticked for them.
    expect(item(subscription.id).preselected).toBe(false);

    // The week's one tap sends only what's ticked; the rest stays.
    await yesToAll(userId, [{ findingId: fee.id, cardHash: item(fee.id).cardHash }], { client });
    expect((await planFor(userId, { client })).map((i) => i.card.findingId).sort()).toEqual(
      [trial.id, subscription.id].sort(),
    );
  });
});
