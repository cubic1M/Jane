import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectionInput } from "@/detection/types";

// CodeRabbit sweep 1c (lib-03): which forecast the tight-money plan is for, with the forecasts
// themselves stubbed.
const stubs = vi.hoisted(() => ({
  forecasts: [] as { accountId: string; days: { date: string; balanceCents: number }[] }[],
  by: {} as Record<string, string | null>,
}));

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: async () => true }));
vi.mock("@/lib/today", () => ({ todayOf: async () => "2026-10-18" }));
vi.mock("@/lib/debts", () => ({ debtsOr: async () => ({ debts: [] }) }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: () => ({
    tightRequests: { findMany: async () => [] },
    transactions: { findMany: async () => [] },
  }),
}));
vi.mock("@/detection/paydays", () => ({ nextPayday: () => null }));
vi.mock("@/detection/forecast", () => ({
  forecastAccounts: () => stubs.forecasts,
  comingUpBills: () => [
    { accountId: "a", merchant: "Rent A", date: "2026-10-21", amountCents: 100_000 },
    { accountId: "b", merchant: "Rent B", date: "2026-10-21", amountCents: 100_000 },
  ],
  nextUnevenPayBy: (_input: unknown, ids: string[]) => stubs.by[ids[0]] ?? null,
}));

import { loadTightMoney } from "./tight-money";

const NOW = new Date("2026-10-18T15:00:00Z");
const input = { accounts: [], asOf: "2026-10-18" } as unknown as DetectionInput;
const flat = (balanceCents: number) => ({ date: "2026-10-20", balanceCents });
const day = (date: string, balanceCents: number) => ({ date, balanceCents });

beforeEach(() => {
  stubs.by = {};
});

describe("the account the tight-money plan is for", () => {
  it("finds a shortfall on a later checking account when the first one stays fine", async () => {
    stubs.forecasts = [
      { accountId: "a", days: [flat(900_000)] },
      { accountId: "b", days: [day("2026-10-22", -20_000)] },
    ];
    const data = await loadTightMoney("u", { client: {} as never, now: NOW, input });
    expect(data.shortfall?.date).toBe("2026-10-22");
    expect(data.billsFirst.map((b) => b.payee)).toEqual(["Rent B"]);
  });

  it("plans for the earliest shortfall across accounts", async () => {
    stubs.forecasts = [
      { accountId: "a", days: [day("2026-10-27", -1_000)] },
      { accountId: "b", days: [day("2026-10-22", -1_000)] },
    ];
    const data = await loadTightMoney("u", { client: {} as never, now: NOW, input });
    expect(data.shortfall?.date).toBe("2026-10-22");
  });

  it("ignores a dip after the next likely deposit, which the forecast calls unreliable", async () => {
    stubs.forecasts = [
      {
        accountId: "a",
        days: [day("2026-10-20", 900_000), day("2026-10-28", -50_000)],
      },
    ];
    stubs.by = { a: "2026-10-24" };
    const data = await loadTightMoney("u", { client: {} as never, now: NOW, input });
    expect(data.shortfall).toBeNull();
    expect(data.available).toBe(true);
  });

  it("still finds a dip before that deposit", async () => {
    stubs.forecasts = [
      { accountId: "a", days: [day("2026-10-21", -50_000), day("2026-10-28", 900_000)] },
    ];
    stubs.by = { a: "2026-10-24" };
    const data = await loadTightMoney("u", { client: {} as never, now: NOW, input });
    expect(data.shortfall?.date).toBe("2026-10-21");
  });
});
