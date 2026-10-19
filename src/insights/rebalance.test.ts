import { describe, expect, it } from "vitest";
import { MIN_ORDER_CENTS } from "@/config/brokerage";
import { DEMO_EMPLOYER_PLAN_MENU } from "@/config/funds";
import { TARGET_MIXES } from "@/config/investing";
import { demoInvestments } from "@/lib/investments/__fixtures__/demo";
import { mixOfTicker as mixOf } from "@/config/funds";
import { rebalancePlan } from "./rebalance";

// Spec step 133: "move to the recommended mix" as orders, with the mix before and after.

const accounts = demoInvestments().accounts;

describe("rebalancePlan on the demo bank", () => {
  const plan = rebalancePlan(accounts, 3, mixOf);

  it("reaches the target mix", () => {
    for (const m of plan.after) {
      expect(m.share, m.assetClass).toBeCloseTo(m.target, 2);
    }
    const before = plan.before.find((m) => m.assetClass === "us_stocks")!;
    expect(before.share).toBeGreaterThan(before.target + 0.2);
  });

  it("pays for each account's buys with its own sales", () => {
    for (const a of accounts) {
      const mine = plan.orders.filter((o) => o.accountId === a.id);
      const sold = mine.filter((o) => o.side === "sell").reduce((s, o) => s + o.amountCents, 0);
      const bought = mine.filter((o) => o.side === "buy").reduce((s, o) => s + o.amountCents, 0);
      const cash = a.holdings.filter((h) => h.isCash).reduce((s, h) => s + h.valueCents, 0);
      expect(bought, a.name).toBeLessThanOrEqual(sold + cash);
      for (const o of mine) expect(o.amountCents).toBeGreaterThanOrEqual(MIN_ORDER_CENTS);
    }
  });

  it("buys only what the 401(k)'s plan offers", () => {
    const k = accounts.find((a) => a.subtype === "401k")!;
    for (const o of plan.orders.filter((o) => o.accountId === k.id && o.side === "buy")) {
      expect(DEMO_EMPLOYER_PLAN_MENU).toContain(o.ticker);
    }
  });

  it("sells losses first in the taxable account, and estimates the gain realised", () => {
    const brokerage = plan.orders.filter((o) => o.accountName === "Demo Brokerage");
    expect(brokerage[0]).toMatchObject({ side: "sell", ticker: "PDIFX" });
    expect(brokerage[0].gainCents).toBeLessThan(0);
    expect(
      plan.orders.filter((o) => o.accountName === "Demo 401(k)").every((o) => o.gainCents === null),
    ).toBe(true);
    expect(plan.realisedGainCents).toBe(plan.orders.reduce((s, o) => s + (o.gainCents ?? 0), 0));
  });

  it("sells the costliest funds first elsewhere", () => {
    const k = plan.orders.filter((o) => o.accountName === "Demo 401(k)" && o.side === "sell");
    expect(k[0].ticker).toBe("SLGFX");
  });

  it("follows the profile, and has a key that changes with the orders", () => {
    const bold = rebalancePlan(accounts, 5, mixOf);
    expect(bold.key).not.toBe(plan.key);
    expect(rebalancePlan(accounts, 3, mixOf).key).toBe(plan.key);
    for (const m of bold.after)
      expect(m.share).toBeCloseTo(TARGET_MIXES[5][m.assetClass as "bonds"] ?? 0, 2);
  });

  it("has nothing to do on target or without holdings", () => {
    const onTarget = accounts.map((a) => ({
      ...a,
      holdings: a.holdings.map((h) => ({ ...h, mix: TARGET_MIXES[3] })),
    }));
    expect(rebalancePlan(onTarget, 3, mixOf).orders).toEqual([]);
    expect(rebalancePlan([], 3, mixOf)).toMatchObject({ orders: [], realisedGainCents: 0 });
  });
});
