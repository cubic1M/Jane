import { describe, expect, it } from "vitest";
import { CASH_HOMES, EMERGENCY_MAX_REACH_DAYS } from "@/config/cash";
import { canHoldEmergency, cashPlan, emergencyHome, type CashPlace } from "./cash";

// Spec step 162: every dollar of cash with a job, the emergency fund always in reach.

// The demo bank: checking, savings and the brokerage's cash.
const PLACES: CashPlace[] = [
  { id: "chk", name: "Demo Checking", kind: "checking", balanceCents: 384_012, rateBps: 7 },
  { id: "sav", name: "Demo Savings", kind: "savings", balanceCents: 2_431_000, rateBps: 39 },
  { id: "brk", name: "Demo Brokerage cash", kind: "sweep", balanceCents: 81_357, rateBps: 50 },
];

describe("cashPlan", () => {
  it("keeps a month in checking, the emergency fund in reach, and the rest earning more", () => {
    const plan = cashPlan({
      places: PLACES,
      monthlySpendingCents: 300_000,
      emergencyTargetCents: 900_000,
    });
    expect(plan.totalCents).toBe(2_896_369);
    expect(plan.buckets.map((b) => [b.key, b.cents, b.home?.key ?? null])).toEqual([
      ["buffer", 300_000, null],
      ["emergency", 900_000, "high_yield_savings"],
      ["longer_term", 1_696_369, "money_market"],
    ]);
    // Now: $268.81 + $9,480.90 + $406.79 a year, rounded each. After: $210 + $3,600 + $7,124.75.
    expect(plan.nowYearlyCents).toBe(10_157);
    expect(plan.afterYearlyCents).toBe(107_457);
    expect(plan.gainCents).toBe(97_300);
    expect(plan.moves).toEqual([
      {
        key: "checking_to_savings",
        fromId: "chk",
        fromName: "Demo Checking",
        toId: "sav",
        toName: "Demo Savings",
        cents: 84_012,
        gainCents: 269,
      },
      {
        key: "sweep_to_money_market",
        fromId: "brk",
        fromName: "Demo Brokerage cash",
        toId: "brk",
        toName: "Money market fund",
        cents: 81_357,
        gainCents: 3_010,
      },
    ]);
    expect(plan.ladder).toEqual([
      { months: 3, cents: 565_456 },
      { months: 6, cents: 565_456 },
      { months: 12, cents: 565_457 },
    ]);
  });

  it("fills the emergency fund before anything goes further away, and skips small moves", () => {
    const plan = cashPlan({
      places: [
        { id: "chk", name: "Checking", kind: "checking", balanceCents: 330_000, rateBps: 7 },
        { id: "sav", name: "Savings", kind: "savings", balanceCents: 500_000, rateBps: 39 },
      ],
      monthlySpendingCents: 300_000,
      emergencyTargetCents: 900_000,
    });
    expect(plan.buckets.map((b) => b.cents)).toEqual([300_000, 530_000, 0]);
    expect(plan.ladder).toEqual([]);
    // $300 over the buffer is under the $500 minimum.
    expect(plan.moves).toEqual([]);
  });
});

describe("the emergency fund is never put where it can't be reached in days", () => {
  it("only homes reachable within the limit can hold it, and the ladder never can", () => {
    expect(EMERGENCY_MAX_REACH_DAYS).toBe(3);
    const ladder = CASH_HOMES.find((h) => h.key === "treasury_ladder")!;
    expect(canHoldEmergency(ladder)).toBe(false);
    expect(emergencyHome().key).toBe("high_yield_savings");
    expect(canHoldEmergency(emergencyHome())).toBe(true);
  });

  it("holds for any amounts", () => {
    for (const total of [0, 10_000, 450_000, 1_200_000, 50_000_000]) {
      for (const spending of [0, 100_000, 400_000]) {
        const plan = cashPlan({
          places: [{ id: "s", name: "S", kind: "savings", balanceCents: total, rateBps: 39 }],
          monthlySpendingCents: spending,
          emergencyTargetCents: spending * 3,
        });
        const emergency = plan.buckets.find((b) => b.key === "emergency")!;
        expect(emergency.home!.reachDays).toBeLessThanOrEqual(EMERGENCY_MAX_REACH_DAYS);
        // The ladder only ever holds what's left after the buffer and the emergency fund.
        const ladder = plan.ladder.reduce((s, r) => s + r.cents, 0);
        expect(ladder).toBe(plan.buckets.find((b) => b.key === "longer_term")!.cents);
        expect(ladder).toBeLessThanOrEqual(Math.max(0, total - spending - spending * 3));
      }
    }
  });
});
