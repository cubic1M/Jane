import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectionInput } from "@/detection/types";

// CodeRabbit sweep 1c (lib-03): what the year's plan is given, with the loaders stubbed so the
// input to the planner is what is checked.
const planner = vi.hoisted(() => ({ seen: null as null | { fixed: unknown; actuals: unknown } }));
const stubs = vi.hoisted(() => ({
  selfEmployed: vi.fn(),
  deadlines: vi.fn(),
  transfers: [] as { runOn: Date; amountCents: number; purpose: string; planKey: string | null }[],
  updateMany: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/planning/year-plan", async (orig) => {
  const real = await orig<typeof import("@/planning/year-plan")>();
  return {
    ...real,
    yearPlan: (input: { fixed: unknown; actuals: unknown }) => {
      planner.seen = { fixed: input.fixed, actuals: input.actuals };
      return real.yearPlan(input as never);
    },
  };
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: () => ({
    yearPlans: {
      findMany: async () => [],
      updateMany: stubs.updateMany,
      create: stubs.create,
    },
    autoInvestPlans: { findFirst: async () => null },
    moneyTransfers: { findMany: async () => stubs.transfers },
    autoInvestRuns: { findMany: async () => [] },
  }),
}));
vi.mock("@/lib/health-score", () => ({
  healthInput: async () => ({ monthlyIncomeCents: 900_000, monthlySpendingCents: 300_000 }),
}));
vi.mock("@/lib/goals", () => ({ listGoals: async () => [] }));
vi.mock("@/lib/debt-plan", () => ({ loadPayoff: async () => ({ stored: null }) }));
vi.mock("@/lib/self-employed", () => ({ loadSelfEmployed: stubs.selfEmployed }));
vi.mock("@/lib/deadlines", () => ({ listDeadlines: stubs.deadlines }));

import { loadYearPlan } from "./year-plan";

const NOW = new Date("2026-10-16T15:00:00Z");
const input = { accounts: [{ id: "a" }], asOf: "2026-10-16" } as unknown as DetectionInput;
const fixedOf = () => planner.seen!.fixed as { month: string; sector: string; cents: number }[];

beforeEach(() => {
  planner.seen = null;
  stubs.transfers = [];
  stubs.updateMany.mockReset().mockResolvedValue({ count: 0 });
  stubs.create.mockReset().mockResolvedValue({});
  stubs.selfEmployed.mockReset().mockResolvedValue({
    federal: { needed: true, payments: [{ date: "2027-01-15", cents: 100_000 }] },
    state: { needed: true, payments: [{ date: "2027-01-15", cents: 25_000 }] },
  });
  stubs.deadlines.mockReset().mockResolvedValue([]);
});

describe("the year plan's fixed amounts", () => {
  it("counts the state's estimated payments as well as the federal ones", async () => {
    await loadYearPlan("u", { client: {} as never, now: NOW, input });
    const taxes = fixedOf().filter((f) => f.sector === "taxes");
    expect(taxes.map((f) => f.cents).sort()).toEqual([100_000, 25_000]);
  });

  it("keeps the federal-only and the no-payment cases", async () => {
    stubs.selfEmployed.mockResolvedValue({
      federal: { needed: true, payments: [{ date: "2027-01-15", cents: 100_000 }] },
      state: null,
    });
    await loadYearPlan("u", { client: {} as never, now: NOW, input });
    expect(fixedOf().filter((f) => f.sector === "taxes")).toHaveLength(1);
    stubs.selfEmployed.mockResolvedValue({
      federal: { needed: false, payments: [{ date: "2027-01-15", cents: 1 }] },
      state: { needed: false, payments: [{ date: "2027-01-15", cents: 1 }] },
    });
    await loadYearPlan("u", { client: {} as never, now: NOW, input });
    expect(fixedOf().filter((f) => f.sector === "taxes")).toHaveLength(0);
  });

  it("includes a hand-entered deadline beyond the list's horizon, inside the year", async () => {
    const warranty = {
      key: "k",
      title: "Annual dues",
      date: "2027-06-10",
      kind: "bill",
      source: "entered",
      amountCents: 40_000,
    };
    stubs.deadlines.mockImplementation(async (_u: string, o: { furtherOut?: boolean }) =>
      o.furtherOut ? [warranty] : [],
    );
    await loadYearPlan("u", { client: {} as never, now: NOW, input });
    expect(fixedOf().filter((f) => f.sector === "deadlines")).toEqual([
      { month: "2027-06", sector: "deadlines", cents: 40_000 },
    ]);
  });
});

describe("the year plan's saving actuals", () => {
  it("leaves the steady paycheck's withdrawal from the buffer out of saving", async () => {
    stubs.transfers = [
      {
        runOn: new Date("2026-10-05T00:00:00Z"),
        amountCents: 50_000,
        purpose: "goal",
        planKey: "deposit:t1:buffer",
      },
      {
        runOn: new Date("2026-10-06T00:00:00Z"),
        amountCents: 7_000,
        purpose: "goal",
        planKey: null,
      },
      {
        runOn: new Date("2026-10-07T00:00:00Z"),
        amountCents: 200_000,
        purpose: "goal",
        planKey: "steady:2026-10",
      },
    ];
    await loadYearPlan("u", {
      client: {} as never,
      now: new Date("2026-11-03T15:00:00Z"),
      input: { ...input, asOf: "2026-11-03" } as never,
    });
    const actuals = planner.seen!.actuals as Record<string, { saving: number }>;
    expect(actuals["2026-10"].saving).toBe(57_000);
  });
});

describe("keeping the plan", () => {
  it("throws the create error when the fallback update saved nothing", async () => {
    stubs.create.mockRejectedValue(new Error("connection lost"));
    await expect(
      loadYearPlan("u", { client: {} as never, now: NOW, input, keep: true }),
    ).rejects.toThrow("connection lost");
  });

  it("is fine when a concurrent insert made the row (the fallback update matches)", async () => {
    stubs.create.mockRejectedValue(new Error("unique"));
    stubs.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    await expect(
      loadYearPlan("u", { client: {} as never, now: NOW, input, keep: true }),
    ).resolves.toBeTruthy();
  });
});
