import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { cashPlan, type CashPlace } from "@/planning/cash";
import type { CashView } from "@/lib/investments/cash";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
// Cash plans are demo advice (every account the demo bank: src/lib/advice-mode.ts).
vi.mock("@/lib/advice-mode", async (actual) => ({
  ...(await actual<typeof import("@/lib/advice-mode")>()),
  adviceMode: vi.fn(async () => true),
}));
// The person's cash as it is today (src/lib/investments/cash.ts), set by each test.
const today = vi.hoisted(() => ({ view: null as CashView | null }));
vi.mock("@/lib/investments/cash", async (actual) => ({
  ...(await actual<typeof import("@/lib/investments/cash")>()),
  loadCash: vi.fn(async () => today.view),
}));

import { CASH_LINK, cashLine, moveButtons } from "./investments/cash-copy";
import { loadPopupStack } from "./popup-stack";
import { snoozeButton } from "./sources/source";

// Gate C's full sweep (debug 3, 11-22, retiree, daily): the dock held nine or ten cards saying "Your
// cash is $74,428.78 and earns about $260.87 a year…", "$74,547.14…", "$74,685.39…", one posted
// most days. Their key was a hash of the plan's amounts, so every move in cash was a new card.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-23T23:00:00Z");

// Checking with $checking in it and a savings account; a brokerage's cash too, when given.
const view = (checking: number, sweep = 0): CashView => {
  const places: CashPlace[] = [
    { id: "chk", name: "Demo Checking", kind: "checking", balanceCents: checking, rateBps: 1 },
    { id: "sav", name: "Demo Savings", kind: "savings", balanceCents: 100_000, rateBps: 400 },
    ...(sweep > 0
      ? [
          {
            id: "brk",
            name: "Demo Brokerage cash",
            kind: "sweep" as const,
            balanceCents: sweep,
            rateBps: 1,
          },
        ]
      : []),
  ];
  const plan = cashPlan({ places, monthlySpendingCents: 300_000, emergencyTargetCents: 0 });
  return {
    advice: true,
    places,
    monthlySpendingCents: 300_000,
    emergencyTargetCents: 0,
    emergencyFromGoal: false,
    emergencyBasis: null,
    // As loadCash keys it: the amounts the person saw.
    plan: { ...plan, key: `seen-${plan.moves.map((m) => m.cents).join("-")}` },
  };
};
// The card as the investments source posts it (./sources/investments.ts cashCards).
const card = (plan: NonNullable<CashView["plan"]>) => ({
  kind: "decision" as const,
  body: `${cashLine(plan)} Each move is a tap; nothing moves until you say so.`,
  refs: { advice: true, cashPlan: plan.key },
  actions: [...moveButtons(plan), CASH_LINK, snoozeButton()],
});

describe.runIf(url)("one cash card at a time", () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { email: { startsWith: "one-cash-" } } });
    await client.$disconnect();
  });
  const person = async () =>
    (await client.user.create({ data: { email: `one-cash-${crypto.randomUUID()}@example.com` } }))
      .id;
  const cashCards = async (userId: string) =>
    (await loadPopupStack(userId, { client, now: NOW })).filter((m) =>
      m.body.startsWith("Your cash is"),
    );

  it("shows the newest of the cards posted before, said with today's figures, the rest put away", async () => {
    const userId = await person();
    for (let day = 14; day <= 22; day += 1) {
      const before = view(7_400_000 + day * 1_000);
      await client.janeMessage.create({
        data: {
          userId,
          ...card(before.plan!),
          dedupeKey: `investments:cash:${day}a1b2c3d4e5f6a7b8c9d0e1f2`,
          createdAt: new Date(`2026-11-${day}T16:00:00Z`),
        },
      });
    }
    today.view = view(7_468_539);
    const shown = await cashCards(userId);
    expect(shown.map((m) => m.body)).toEqual([card(today.view.plan!).body]);
    const rows = await client.janeMessage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    expect(rows.map((r) => r.status)).toEqual(["open", ...Array(8).fill("answered")]);
    // Stored as shown: a move tapped checks today's plan (src/lib/investments/cash.ts moveCash).
    expect(rows[0].refs).toMatchObject({ cashPlan: today.view.plan!.key });
    expect(rows[0].actions).toEqual(card(today.view.plan!).actions);
  });

  it("is put away once there's no plan worth bringing up", async () => {
    const userId = await person();
    const was = view(7_442_878);
    await client.janeMessage.create({
      data: {
        userId,
        ...card(was.plan!),
        dedupeKey: "investments:cash:a1b2c3d4e5f6a7b8c9d0e1f2",
        createdAt: new Date("2026-11-20T16:00:00Z"),
      },
    });
    today.view = { ...was, plan: null };
    expect(await cashCards(userId)).toEqual([]);
    expect((await client.janeMessage.findFirstOrThrow({ where: { userId } })).status).toBe(
      "answered",
    );
  });
});
