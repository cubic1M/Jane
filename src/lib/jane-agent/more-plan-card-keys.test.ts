import { describe, expect, it } from "vitest";
import type { Bnpl } from "@/lib/bnpl";
import { demoInvestmentSnapshot } from "@/lib/investments/__fixtures__/demo";
import { locationPlan, type PlanAccount } from "@/planning/location";
import type { BudgetProposal } from "@/planning/proposals";
import type { Snapshot } from "./snapshot";
import { bnplSource } from "./sources/bnpl";
import { investmentsSource } from "./sources/investments";
import { setupSource } from "./sources/setup";

// The manager after gate C (11-23): the other cards keyed by their figures. A Pay in 4 plan free
// to pay off was keyed by its balance (a new card after each installment), a set-up budget by its
// amount, the location swaps by each swap's amount. Each is now keyed by what it asks.

const ASOF = "2026-11-23";
const context = { now: new Date(`${ASOF}T16:00:00Z`), local: { date: ASOF, hour: 8 } } as never;
const snapshot = (over: Partial<Snapshot>) =>
  ({ asOf: ASOF, safeToSpend: null, setupProposals: [], ...over }) as unknown as Snapshot;

const bnpl = (balanceCents: number, key = "klarna-1"): Bnpl =>
  ({
    available: true,
    asOf: ASOF,
    plans: [
      {
        key,
        name: "Klarna Pay in 4",
        freePayoff: true,
        canCoverPayoff: true,
        payoffScheduled: false,
        balanceCents,
      },
    ],
    installments: [],
    missing: [],
    checkingCents: 200_000,
    forecastDays: [],
  }) as unknown as Bnpl;
const payoffKey = (data: Bnpl) =>
  bnplSource
    .gather(snapshot({ bnpl: data } as Partial<Snapshot>), context)
    .find((c) => c.dedupeKey.startsWith("bnpl_payoff:"))?.dedupeKey;

const budget = (amountCents: number, category = "Food and drink"): BudgetProposal => ({
  kind: "budget",
  key: `budget:${category}`,
  category,
  amountCents,
  months: 3,
});
const setupKey = (p: BudgetProposal) =>
  setupSource.gather(snapshot({ setupProposals: [p] }), context)[0]?.dedupeKey;

const account = (
  id: string,
  kind: PlanAccount["kind"],
  ticker: string,
  cents: number,
  cls: "bonds" | "us_stocks",
) => ({
  id,
  name: id,
  kind,
  holdings: [{ ticker, name: ticker, valueCents: cents, moveClass: cls, gainCents: 0 }],
});
const location = (cents: number) =>
  locationPlan({
    accounts: [
      account("k", "pre_tax", "KTSIX", cents, "us_stocks"),
      account("t", "taxable", "KTBIX", cents, "bonds"),
    ],
    yieldBps: { bonds: 380, us_stocks: 170, intl_stocks: 290 },
    payoutRate: { bonds: 0.22, us_stocks: 0.15, intl_stocks: 0.15 },
    gainRate: 0.15,
  });
const locationKey = (cents: number) =>
  investmentsSource
    .gather(
      snapshot({
        investments: demoInvestmentSnapshot({ advice: true, location: { plan: location(cents) } }),
      } as Partial<Snapshot>),
      context,
    )
    .find((c) => c.dedupeKey.startsWith("location:"))?.dedupeKey;

describe("a card's key is what it asks, not its figures", () => {
  it("a Pay in 4 plan to pay off: the plan, whatever its balance", () => {
    expect(payoffKey(bnpl(12_000))).toBe(payoffKey(bnpl(9_000)));
    expect(payoffKey(bnpl(12_000))).not.toBe(payoffKey(bnpl(12_000, "afterpay-2")));
  });

  it("a set-up budget: the budget, whatever its amount", () => {
    expect(setupKey(budget(50_000))).toBe(setupKey(budget(52_000)));
    expect(setupKey(budget(50_000))).not.toBe(setupKey(budget(50_000, "Entertainment")));
  });

  it("the location swaps: which kind moves between which accounts, whatever the amounts", () => {
    expect(locationKey(10_000_000)).toBeDefined();
    expect(locationKey(10_000_000)).toBe(locationKey(10_400_000));
  });
});
