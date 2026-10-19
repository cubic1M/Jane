import { describe, expect, it } from "vitest";
import { DEBT_EXTRA_SCENARIOS_CENTS } from "@/config/debt";
import type { Debt } from "@/insights/debts";
import { payoffPlan, type PayoffPlan } from "./debt";
import {
  expectedBalances,
  minimumsOnly,
  monthAfter,
  payoffSummary,
  pickStrategy,
  planDebts,
} from "./payoff";

const debt = (over: Partial<Debt> & Pick<Debt, "key" | "kind">): Debt => ({
  accountId: null,
  name: over.key,
  kindLabel: over.kind,
  balanceCents: 100_000,
  balanceFrom: "bank",
  aprBps: 1000,
  rateType: null,
  aprFrom: "bank",
  paymentCents: 5_000,
  paymentEvery: "month",
  paymentFrom: "bank",
  nextDue: null,
  dueSoon: false,
  payoffDate: null,
  payoffFrom: null,
  overdue: false,
  pastDueCents: null,
  description: null,
  inNetWorth: true,
  typedOn: null,
  ...over,
});

const CARD = debt({
  key: "card",
  kind: "card",
  balanceCents: 241_050,
  aprBps: 2299,
  paymentCents: 7_500,
});
const CAR = debt({
  key: "car",
  kind: "auto",
  balanceCents: 1_802_000,
  aprBps: 690,
  paymentCents: 49_410,
});
const STUDENT = debt({
  key: "student",
  kind: "student",
  balanceCents: 1_834_500,
  aprBps: 525,
  paymentCents: 19_500,
});
const KLARNA = debt({
  key: "klarna",
  kind: "bnpl",
  balanceCents: 12_450,
  aprBps: 0,
  paymentCents: 6_225,
  paymentEvery: "two_weeks",
  inNetWorth: false,
});
const HOME = debt({
  key: "home",
  kind: "mortgage",
  balanceCents: 31_240_000,
  aprBps: 399,
  paymentCents: 214_154,
});
const AFFIRM = debt({
  key: "affirm",
  kind: "bnpl",
  balanceCents: null,
  aprBps: null,
  paymentCents: 8_950,
});
const STORE = debt({ key: "store", kind: "card", aprBps: 2899, paymentCents: null });

describe("the debts a payoff plan covers", () => {
  it("takes every debt with a balance, rate and payment, but not the mortgage", () => {
    const { cards, leftOut } = planDebts([CARD, CAR, KLARNA, HOME, AFFIRM, STORE]);
    expect(cards.map((c) => c.id)).toEqual(["card", "car", "klarna"]);
    // Pay in 4's two-weekly payment counts twice a month.
    expect(cards.find((c) => c.id === "klarna")?.minimumCents).toBe(12_450);
    expect(leftOut).toEqual([
      { name: "home", reason: "mortgage" },
      { name: "affirm", reason: "no_balance" },
      { name: "store", reason: "no_payment" },
    ]);
  });

  it("names a debt with no rate or no balance yet as left out, and skips one paid off", () => {
    const noRate = debt({ key: "x", kind: "loan", aprBps: null });
    expect(planDebts([noRate]).leftOut).toEqual([{ name: "x", reason: "no_rate" }]);
    expect(planDebts([AFFIRM]).leftOut).toEqual([{ name: "affirm", reason: "no_balance" }]);
    expect(planDebts([debt({ key: "done", kind: "card", balanceCents: 0 })])).toEqual({
      cards: [],
      leftOut: [],
    });
  });
});

describe("the payoff plan", () => {
  const debts = [CARD, CAR, STUDENT, KLARNA];

  it("uses the debt planner's own math, so the numbers always match /debt", () => {
    const summary = payoffSummary(debts, { extraCents: 10_000, advice: false });
    const budget = summary.minimumsCents + 10_000;
    expect(summary.minimumsCents).toBe(7_500 + 49_410 + 19_500 + 12_450);
    expect(summary.avalanche).toEqual(payoffPlan(summary.cards, budget, "avalanche"));
    expect(summary.snowball).toEqual(payoffPlan(summary.cards, budget, "snowball"));
  });

  it("measures interest saved against each debt paying only its own minimum", () => {
    const summary = payoffSummary(debts, { extraCents: 0, advice: false });
    const alone = summary.cards.map((c) => payoffPlan([c], c.minimumCents, "avalanche"));
    const baseline = minimumsOnly(summary.cards);
    expect(baseline.ok && baseline.totalInterestCents).toBe(
      alone.reduce((sum, p) => sum + (p.ok ? p.totalInterestCents : 0), 0),
    );
    // Rolling a paid-off debt's payment into the next always costs less.
    const [first] = summary.scenarios;
    expect(first.extraCents).toBe(0);
    expect(first.interestSavedCents).toBeGreaterThan(0);
    expect(summary.savedAgainst).toBe("minimums");
  });

  it("shows what paying more each month does, each scenario sooner and cheaper", () => {
    const { scenarios } = payoffSummary(debts, { extraCents: 0, advice: false });
    expect(scenarios.map((s) => s.extraCents)).toEqual([...DEBT_EXTRA_SCENARIOS_CENTS]);
    for (let i = 1; i < scenarios.length; i += 1) {
      expect(scenarios[i].months).toBeLessThanOrEqual(scenarios[i - 1].months);
      expect(scenarios[i].interestCents).toBeLessThan(scenarios[i - 1].interestCents);
    }
  });

  it("measures paying more against the plan when the minimums alone never pay a debt off", () => {
    // $2,410.50 at 22.99% costs about $46 a month; a $35 minimum never catches up.
    const tight = debt({
      key: "card",
      kind: "card",
      balanceCents: 241_050,
      aprBps: 2299,
      paymentCents: 3_500,
    });
    const summary = payoffSummary([tight, CAR], { extraCents: 0, advice: false });
    expect(summary.baseline.ok).toBe(false);
    expect(summary.savedAgainst).toBe("plan");
    const [asIs, ...more] = summary.scenarios;
    expect(asIs.interestSavedCents).toBeNull();
    for (const s of more) {
      expect(s.interestSavedCents).toBe(asIs.interestCents - s.interestCents);
      expect(s.interestSavedCents).toBeGreaterThan(0);
    }
    // With the car's payment rolling over once it's paid off, the plan still finishes.
    expect(summary.avalanche.ok).toBe(true);
  });

  it("picks an order only in demo advice mode", () => {
    expect(payoffSummary(debts, { extraCents: 0, advice: false }).pick).toBeNull();
    const { pick } = payoffSummary(debts, { extraCents: 0, advice: true });
    expect(pick?.strategy).toBe("avalanche");
    expect(pick?.order).toEqual(["card", "car", "student", "klarna"]);
    expect(pick?.why[0]).toBe(
      "Your card has the highest rate (22.99%), so every extra dollar there saves the most interest.",
    );
    expect(pick?.why.length).toBeLessThanOrEqual(3);
  });
});

describe("which order Jane picks", () => {
  const ok = (
    months: number,
    interest: number,
    paidOffMonth: Record<string, number>,
  ): PayoffPlan => ({
    ok: true,
    strategy: "avalanche",
    months,
    totalInterestCents: interest,
    totalPaidCents: 0,
    paidOffMonth,
    schedule: [],
  });
  const cards = planDebts([
    CARD,
    debt({ key: "small", kind: "card", balanceCents: 20_000, aprBps: 1500 }),
  ]).cards;

  it("takes smallest balance first when it costs little more and wins much sooner", () => {
    const pick = pickStrategy(
      cards,
      ok(30, 100_000, { card: 10, small: 20 }),
      ok(30, 103_000, { card: 12, small: 4 }),
    );
    expect(pick.strategy).toBe("snowball");
    expect(pick.why).toEqual([
      "Smallest balance first clears your small 6 months sooner, so you see progress early.",
      "It costs only $30.00 more in interest than highest rate first.",
    ]);
  });

  it("takes highest rate first when the early win costs too much", () => {
    const pick = pickStrategy(
      cards,
      ok(30, 100_000, { card: 10, small: 20 }),
      ok(30, 120_000, { card: 12, small: 4 }),
    );
    expect(pick.strategy).toBe("avalanche");
    expect(pick.why[1]).toBe(
      "That's $200.00 less interest than paying the smallest balance first.",
    );
  });

  it("says the order doesn't matter with one debt", () => {
    const one = planDebts([CARD]).cards;
    expect(pickStrategy(one, ok(10, 1, { card: 10 }), ok(10, 1, { card: 10 })).why[0]).toMatch(
      /With one debt, the order doesn't matter/,
    );
  });
});

describe("checking the plan each month", () => {
  it("lays out what should be owed at the end of each month", () => {
    const summary = payoffSummary([CARD, CAR], { extraCents: 0, advice: false });
    const expected = expectedBalances(summary.cards, summary.avalanche);
    expect(expected[0]).toBe(241_050 + 1_802_000);
    expect(expected[1]).toBeLessThan(expected[0]);
    expect([...expected].sort((a, b) => b - a)).toEqual(expected);
    expect(monthAfter("2026-10-19", 3)).toBe("2027-01");
  });
});
