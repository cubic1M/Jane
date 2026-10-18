import { describe, expect, it } from "vitest";
import { MAX_PAYOFF_MONTHS } from "@/config/planning";
import { monthlyInterest, parseApr, payoffOrder, payoffPlan, type DebtCard } from "./debt";

const card = (
  id: string,
  balanceCents: number,
  aprBps: number,
  minimumCents: number,
): DebtCard => ({
  id,
  name: id,
  balanceCents,
  aprBps,
  minimumCents,
});

// Every expected number below was worked out by hand, month by month, with interest
// rounded to the cent each month.
describe("payoffPlan", () => {
  it("pays $1,000 at 12% with $100 a month in 11 months and $58.98 interest", () => {
    const plan = payoffPlan([card("a", 100_000, 1_200, 2_500)], 10_000, "avalanche");
    if (!plan.ok) throw new Error(plan.reason);

    expect(plan.months).toBe(11);
    expect(plan.totalInterestCents).toBe(5_898);
    expect(plan.totalPaidCents).toBe(105_898);
    expect(plan.schedule.map((m) => m.interestCents)).toEqual([
      1_000, 910, 819, 727, 635, 541, 446, 351, 254, 157, 58,
    ]);
    expect(plan.schedule.map((m) => m.balances.a)).toEqual([
      91_000, 81_910, 72_729, 63_456, 54_091, 44_632, 35_078, 25_429, 15_683, 5_840, 0,
    ]);
    expect(plan.schedule.at(-1)?.paidCents).toBe(5_898);
  });

  // A: $100 at 12%, B: $300 at 24%, $10 minimums, $150 a month.
  const cards = [card("a", 10_000, 1_200, 1_000), card("b", 30_000, 2_400, 1_000)];

  it("avalanche: B first, $12.64 interest over 3 months", () => {
    const plan = payoffPlan(cards, 15_000, "avalanche");
    if (!plan.ok) throw new Error(plan.reason);

    expect(plan.schedule.map((m) => m.interestCents)).toEqual([700, 423, 141]);
    expect(plan.schedule.map((m) => m.balances)).toEqual([
      { b: 16_600, a: 9_100 },
      { b: 2_932, a: 8_191 },
      { b: 0, a: 0 },
    ]);
    expect(plan).toMatchObject({
      months: 3,
      totalInterestCents: 1_264,
      totalPaidCents: 41_264,
      paidOffMonth: { a: 3, b: 3 },
    });
  });

  it("snowball: A first, $14.38 interest over 3 months", () => {
    const plan = payoffPlan(cards, 15_000, "snowball");
    if (!plan.ok) throw new Error(plan.reason);

    expect(plan.schedule.map((m) => m.interestCents)).toEqual([700, 514, 224]);
    expect(plan.schedule.map((m) => m.balances)).toEqual([
      { a: 0, b: 25_700 },
      { a: 0, b: 11_214 },
      { a: 0, b: 0 },
    ]);
    expect(plan).toMatchObject({
      months: 3,
      totalInterestCents: 1_438,
      totalPaidCents: 41_438,
      paidOffMonth: { a: 1, b: 3 },
    });
  });

  it("refuses a budget below the minimums, and says when it never pays off", () => {
    expect(payoffPlan(cards, 1_500, "snowball")).toEqual({
      ok: false,
      strategy: "snowball",
      reason: "budget_below_minimums",
    });
    // $10,000 at 24% charges $200 a month in interest; $150 never catches up.
    expect(payoffPlan([card("big", 1_000_000, 2_400, 15_000)], 15_000, "avalanche")).toMatchObject({
      ok: false,
      reason: "never_pays_off",
    });
  });

  it("ignores cards already at zero", () => {
    const plan = payoffPlan(
      [card("paid", 0, 2_000, 2_500), card("a", 10_000, 0, 0)],
      5_000,
      "snowball",
    );
    expect(plan).toMatchObject({ ok: true, months: 2, totalInterestCents: 0 });
  });

  it("stops within the month limit", () => {
    expect(MAX_PAYOFF_MONTHS).toBeGreaterThan(120);
  });
});

describe("payoffOrder", () => {
  const cards = [card("small-low", 10_000, 1_000, 0), card("big-high", 50_000, 2_900, 0)];
  it("orders avalanche by rate and snowball by balance", () => {
    expect(payoffOrder(cards, "avalanche").map((c) => c.id)).toEqual(["big-high", "small-low"]);
    expect(payoffOrder(cards, "snowball").map((c) => c.id)).toEqual(["small-low", "big-high"]);
  });
});

describe("helpers", () => {
  it("rounds monthly interest to the cent", () => {
    expect(monthlyInterest(81_910, 1_200)).toBe(819);
    expect(monthlyInterest(30_600, 2_400)).toBe(612);
  });

  it("reads APRs people type", () => {
    expect(parseApr("24.99")).toBe(2_499);
    expect(parseApr("24.99%")).toBe(2_499);
    expect(parseApr(" 0 ")).toBe(0);
    expect(parseApr("abc")).toBeNull();
    expect(parseApr("150")).toBeNull();
  });
});
