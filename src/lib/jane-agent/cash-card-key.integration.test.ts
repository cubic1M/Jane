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

import type { PlannedMessage } from "./brain";
import { cashCard, cashCardKey } from "./investments/cash-copy";
import { postMessages } from "./messages";

// Gate C's full sweep (debug 3, 11-22, retiree, daily): the dock held nine or ten cards saying "Your
// cash is $74,428.78 and earns about $260.87 a year…", "$74,547.14…", "$74,685.39…", one posted
// most days. Their key was a hash of the plan's amounts, so every move in cash was a new card.

const url = process.env.TEST_DATABASE_URL;

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
// The investments source's card for today's cash (./sources/investments.ts cashCards).
const planned = (v: CashView): PlannedMessage[] => [
  {
    ...cashCard(v.plan!),
    source: "investments",
    dedupeKey: `investments:cash:${cashCardKey(v.plan!)}`,
    priority: 50,
  },
];

describe("the cash card's key", () => {
  it("is what it asks, not its figures", () => {
    expect(cashCardKey(view(7_442_878).plan!)).toBe(cashCardKey(view(7_468_539).plan!));
    expect(cashCardKey(view(7_442_878).plan!)).not.toBe(
      cashCardKey(view(7_442_878, 2_000_000).plan!),
    );
  });
});

describe.runIf(url)("the cash card, posted", () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { email: { startsWith: "cash-key-" } } });
    await client.$disconnect();
  });
  const person = async () =>
    (await client.user.create({ data: { email: `cash-key-${crypto.randomUUID()}@example.com` } }))
      .id;

  it("isn't posted again as cash moves, open or answered, and is when the plan's moves change", async () => {
    const userId = await person();
    today.view = view(7_442_878);
    const at = (day: number) => ({ client, now: new Date(`2026-11-${day}T16:00:00Z`) });
    expect(await postMessages(userId, planned(view(7_442_878)), at(20))).toBe(1);
    expect(await postMessages(userId, planned(view(7_454_714)), at(21))).toBe(0);
    await client.janeMessage.updateMany({
      where: { userId },
      data: { status: "answered", answeredAt: at(21).now },
    });
    expect(await postMessages(userId, planned(view(7_468_539)), at(22))).toBe(0);
    // Brokerage cash to put in a money market fund: a move the person wasn't asked about.
    expect(await postMessages(userId, planned(view(7_468_539, 2_000_000)), at(23))).toBe(1);
  });
});
