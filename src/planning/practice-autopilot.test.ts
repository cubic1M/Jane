import { describe, expect, it } from "vitest";
import { AUTOPILOT_LIMITS, MODEL_PORTFOLIOS, PRACTICE_ETFS } from "@/config/portfolios";
import { apply, type LedgerState } from "./practice-ledger";
import {
  buyFundFor,
  monthlyDue,
  planTrades,
  portfolioValue,
  sellsFirst,
  violates,
} from "./practice-autopilot";

const PRICES = { VTI: 30_000, VXUS: 6_000, BND: 8_000, BIL: 9_150, TSLA: 20_000, ITOT: 12_000 };
const UNIVERSE = new Set(["VTI", "VXUS", "BND", "BIL", "TSLA", "ITOT"]);
const empty = (cash: number): LedgerState => ({ cashCents: cash, positions: {} });

function run(level: 1 | 2 | 3 | 4 | 5, state: LedgerState, paused = false) {
  const trades = planTrades({ level, state, prices: PRICES, paused, tradesToday: 0 });
  let s = state;
  for (const t of trades) {
    s = apply(
      s,
      {
        side: t.side,
        ticker: t.ticker,
        amountCents: t.amountCents,
        priceCents: PRICES[t.ticker as keyof typeof PRICES],
      },
      UNIVERSE,
    ).state;
  }
  return { trades, state: s };
}

describe("autopilot for the practice portfolio", () => {
  it("buys the model for each level out of cash, with a reason and a rule on every trade", () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      const { trades, state } = run(level, empty(1_000_000));
      expect(trades.length).toBeGreaterThan(0);
      expect(trades.every((t) => t.reason.length > 20 && t.rule === "model_buy")).toBe(true);
      const total = portfolioValue(state, PRICES);
      for (const c of Object.keys(PRACTICE_ETFS) as (keyof typeof PRACTICE_ETFS)[]) {
        const share =
          ((state.positions[PRACTICE_ETFS[c].ticker]?.quantity ?? 0) *
            PRICES[PRACTICE_ETFS[c].ticker as keyof typeof PRICES]) /
          total;
        expect(Math.abs(share - MODEL_PORTFOLIOS[level].weights[c])).toBeLessThan(0.02);
      }
    }
  });

  it("does nothing when paused", () => {
    expect(run(3, empty(1_000_000), true).trades).toEqual([]);
  });

  it("does nothing once on target, and rebalances only past the band", () => {
    const { state } = run(3, empty(1_000_000));
    expect(planTrades({ level: 3, state, prices: PRICES, paused: false, tradesToday: 0 })).toEqual(
      [],
    );
    // US stocks rise 30%: well past the band.
    const up = { ...PRICES, VTI: 39_000 };
    const trades = planTrades({ level: 3, state, prices: up, paused: false, tradesToday: 0 });
    expect(
      trades.some((t) => t.side === "sell" && t.ticker === "VTI" && t.rule === "rebalance"),
    ).toBe(true);
    // A 2% wiggle does nothing.
    expect(
      planTrades({
        level: 3,
        state,
        prices: { ...PRICES, VTI: 30_600 },
        paused: false,
        tradesToday: 0,
      }),
    ).toEqual([]);
  });

  it("rebalances at the person's pace, and keeps one fund under their cap", () => {
    const { state } = run(3, empty(1_000_000));
    // US stocks up 18%: about 4 points over their target, inside the usual 5-point band.
    const up = { ...PRICES, VTI: 35_400 };
    const plan = (rebalanceBand: number) =>
      planTrades({
        level: 3,
        state,
        prices: up,
        paused: false,
        tradesToday: 0,
        limits: { ...AUTOPILOT_LIMITS, rebalanceBand },
      });
    expect(plan(AUTOPILOT_LIMITS.rebalanceBand)).toEqual([]);
    expect(plan(0.03).some((t) => t.side === "sell" && t.ticker === "VTI")).toBe(true);

    // At most 30% in one fund: US stocks stop there, the rest of their share stays as cash.
    const capped = planTrades({
      level: 3,
      state: empty(1_000_000),
      prices: PRICES,
      paused: false,
      tradesToday: 0,
      limits: { ...AUTOPILOT_LIMITS, perEtfShare: 0.3 },
    });
    const vti = capped.filter((t) => t.ticker === "VTI").reduce((s, t) => s + t.amountCents, 0);
    expect(vti).toBeLessThanOrEqual(300_000);
    expect(vti).toBeGreaterThan(250_000);
    // A person's limit never raises a hard one.
    const loose = planTrades({
      level: 3,
      state: empty(1_000_000),
      prices: PRICES,
      paused: false,
      tradesToday: 0,
      limits: { ...AUTOPILOT_LIMITS, perEtfShare: 1, perTradeShare: 1 },
    });
    for (const t of loose) expect(t.amountCents).toBeLessThanOrEqual(700_000);
  });

  it("moves a kind into the fund the person chose, and buys there from then on", () => {
    const prices = { ...PRICES, VTV: 15_000 };
    const universe = new Set([...UNIVERSE, "VTV"]);
    const { state } = run(3, empty(1_000_000));
    const funds = { us_stocks: "VTV" };
    const moves = planTrades({ level: 3, state, prices, paused: false, tradesToday: 0, funds });
    const vti = Math.round(state.positions.VTI.quantity * prices.VTI);
    expect(moves.map((t) => [t.side, t.ticker, t.rule])).toEqual([
      ["sell", "VTI", "strategy_switch"],
      ["buy", "VTV", "strategy_switch"],
    ]);
    expect(moves.every((t) => t.amountCents === vti)).toBe(true);
    expect(moves[0].reason).toMatch(/to VTV, the fund of the strategy you chose/);
    let after = state;
    for (const t of sellsFirst(moves))
      after = apply(
        after,
        { ...t, priceCents: prices[t.ticker as keyof typeof prices] },
        universe,
      ).state;
    // Done once: nothing to move again, and new money goes to VTV.
    expect(
      planTrades({ level: 3, state: after, prices, paused: false, tradesToday: 0, funds }),
    ).toEqual([]);
    const more = { ...after, cashCents: after.cashCents + 300_000 };
    const buys = planTrades({
      level: 3,
      state: more,
      prices,
      paused: false,
      tradesToday: 0,
      funds,
    });
    expect(buys.some((t) => t.ticker === "VTV" && t.side === "buy" && t.rule === "rebalance")).toBe(
      true,
    );
    expect(buys.some((t) => t.ticker === "VTI")).toBe(false);
  });

  it("adds new cash to what is under target, never borrowing", () => {
    const { state } = run(2, empty(1_000_000));
    const more = { ...state, cashCents: state.cashCents + 100_000 };
    const trades = planTrades({
      level: 2,
      state: more,
      prices: PRICES,
      paused: false,
      tradesToday: 0,
    });
    expect(trades.every((t) => t.side === "buy")).toBe(true);
    expect(trades.reduce((s, t) => s + t.amountCents, 0)).toBeLessThanOrEqual(more.cashCents);
  });

  it("holds every order to the hard limits", () => {
    const rich = empty(10_000_000);
    expect(
      violates({ ticker: "VTI", side: "buy", amountCents: 8_000_000 }, rich, PRICES, 0),
    ).toMatch(/per-trade/);
    expect(
      violates({ ticker: "VTI", side: "buy", amountCents: 10_000_001 }, rich, PRICES, 0),
    ).not.toBeNull();
    expect(
      violates(
        { ticker: "VTI", side: "buy", amountCents: 100_000 },
        rich,
        PRICES,
        AUTOPILOT_LIMITS.tradesPerDay,
      ),
    ).toMatch(/trades today/);
    // A single company's stock may be at most 3% of the portfolio.
    expect(
      violates({ ticker: "TSLA", side: "buy", amountCents: 400_000 }, rich, PRICES, 0),
    ).toMatch(/per-position/);
    expect(
      violates({ ticker: "TSLA", side: "buy", amountCents: 200_000 }, rich, PRICES, 0),
    ).toBeNull();
    expect(
      violates({ ticker: "VTI", side: "buy", amountCents: 100_000 }, empty(50_000), PRICES, 0),
    ).toMatch(/borrow/);
  });

  it("counts a swapped-into fund as its kind, and never buys back one just sold at a loss", () => {
    const { state } = run(3, empty(1_000_000));
    // US stocks swapped from VTI into ITOT (a tax-loss swap, step 292).
    const vti = state.positions.VTI;
    const swapped: LedgerState = {
      cashCents: state.cashCents,
      positions: {
        ...Object.fromEntries(Object.entries(state.positions).filter(([t]) => t !== "VTI")),
        ITOT: { quantity: (vti.quantity * PRICES.VTI) / PRICES.ITOT, costBasisCents: 400_000 },
      },
    };
    const input = { level: 3 as const, state: swapped, prices: PRICES, paused: false };
    expect(planTrades({ ...input, tradesToday: 0 })).toEqual([]);
    // New money goes to US stocks through ITOT, and never VTI while VTI is blocked.
    const more = { ...swapped, cashCents: swapped.cashCents + 200_000 };
    const trades = planTrades({ ...input, state: more, tradesToday: 0, blocked: new Set(["VTI"]) });
    expect(trades.some((t) => t.ticker === "ITOT" && t.side === "buy")).toBe(true);
    expect(trades.some((t) => t.ticker === "VTI")).toBe(false);
  });

  it("buys the kind's own fund, even at a loss, and its swap partner only when it's blocked", () => {
    const { state } = run(3, empty(1_000_000));
    // VTI down 20% since it was bought: new money still goes to VTI for someone whose losses
    // aren't harvested; the partner is for swaps.
    const down = { ...PRICES, VTI: 24_000 };
    const more = { ...state, cashCents: state.cashCents + 300_000 };
    const input = { level: 3 as const, state: more, prices: down, paused: false, tradesToday: 0 };
    const trades = planTrades(input);
    expect(trades.some((t) => t.ticker === "VTI" && t.side === "buy")).toBe(true);
    expect(trades.some((t) => t.ticker === "ITOT")).toBe(false);
    // Harvesting their losses: the buy goes to ITOT, so a harvest of VTI isn't a wash sale.
    const harvesting = planTrades({ ...input, harvesting: true });
    expect(harvesting.some((t) => t.ticker === "ITOT" && t.side === "buy")).toBe(true);
    expect(harvesting.some((t) => t.ticker === "VTI" && t.side === "buy")).toBe(false);
    // Sold at a loss lately (the wash-sale window): the partner.
    const blocked = planTrades({ ...input, blocked: new Set(["VTI"]) });
    expect(blocked.some((t) => t.ticker === "ITOT" && t.side === "buy")).toBe(true);
    expect(buyFundFor("us_stocks", new Set())).toBe("VTI");
    expect(buyFundFor("us_stocks", new Set(["VTI", "ITOT"]))).toBeNull();
  });

  it("says the real share when it invests cash waiting, to a tenth of a point", () => {
    const { state } = run(3, empty(1_000_000));
    const more = { ...state, cashCents: state.cashCents + 20_000 };
    const trades = planTrades({
      level: 3,
      state: more,
      prices: PRICES,
      paused: false,
      tradesToday: 0,
    });
    expect(trades.filter((x) => x.side === "buy").length).toBeGreaterThan(0);
    for (const t of trades.filter((x) => x.side === "buy")) {
      expect(t.reason).toMatch(/^\$[\d,.]+ of cash waiting went to /);
      const [, now, target] = /: ([\d.]+)% of the portfolio against a target of ([\d.]+)%/.exec(
        t.reason,
      )!;
      expect(now).not.toBe(target);
    }
  });

  it("rebalances when stocks together drift past their band, even if no one kind does", () => {
    const { state } = run(3, empty(1_000_000));
    // Both stock funds up 30%: each kind is under 5 points off, stocks together are over.
    const up = { ...PRICES, VTI: 39_000, VXUS: 7_800 };
    const trades = planTrades({ level: 3, state, prices: up, paused: false, tradesToday: 0 });
    expect(trades.filter((t) => t.side === "sell").map((t) => t.ticker)).toEqual(["VTI", "VXUS"]);
    expect(trades.every((t) => t.rule === "rebalance")).toBe(true);
  });
});

describe("monthlyDue and sellsFirst", () => {
  const due = { monthlyAddCents: 50_000, addDay: 5, today: "2026-10-05", addedThisMonth: false };
  it("puts the monthly money in once a month, on or after its day", () => {
    expect(monthlyDue(due)).toBe(true);
    expect(monthlyDue({ ...due, today: "2026-10-04" })).toBe(false);
    expect(monthlyDue({ ...due, today: "2026-10-31" })).toBe(true);
    expect(monthlyDue({ ...due, addedThisMonth: true })).toBe(false);
    expect(monthlyDue({ ...due, monthlyAddCents: 0 })).toBe(false);
  });

  it("places sales before buys, keeping each side's order", () => {
    const plan = [
      { side: "buy" as const, ticker: "A" },
      { side: "sell" as const, ticker: "B" },
      { side: "buy" as const, ticker: "C" },
      { side: "sell" as const, ticker: "D" },
    ];
    expect(sellsFirst(plan).map((t) => t.ticker)).toEqual(["B", "D", "A", "C"]);
  });
});
