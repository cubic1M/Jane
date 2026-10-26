import { describe, expect, it } from "vitest";
import { AGENT_MARKETS, AGENT_TRAIN_SHARE } from "@/config/trading-agent";
import { timelineOf } from "./clock";
import { walkBars } from "./fixtures";
import { barReturns, holdReplay, metricsOf, runGroup } from "./harness";
import { policiesFor } from "./policies";
import type { AgentTrade } from "./types";

// The replay's figures: worked by hand, walk-forward out of sample, and the haircut for testing
// many strategies.

const crypto = AGENT_MARKETS.crypto;
const trade = (over: Partial<AgentTrade>): AgentTrade => ({
  at: "2026-01-01T00:00:00Z",
  ticker: "BTC/USD",
  side: "buy",
  quantity: 1,
  priceCents: 100,
  amountCents: 100,
  feeCents: 0,
  spreadCents: 0,
  reason: "",
  source: "rule",
  ...over,
});

describe("metricsOf", () => {
  it("matches a hand-worked path", () => {
    // 100 → 120 → 90 → 99 over exactly one year: CAGR −1%, worst drop 25% (120 to 90).
    const times = [
      "2025-01-01T00:00:00.000Z",
      "2025-05-01T00:00:00.000Z",
      "2025-09-01T00:00:00.000Z",
      new Date(Date.parse("2025-01-01T00:00:00.000Z") + 365.25 * 86_400_000).toISOString(),
    ];
    const r = barReturns([100, 120, 90, 99]);
    const trades = [
      trade({ at: times[1], side: "buy", quantity: 1, amountCents: 100, feeCents: 1 }),
      trade({ at: times[2], side: "sell", quantity: 0.5, amountCents: 60, feeCents: 1 }),
      trade({ at: times[3], side: "sell", quantity: 0.5, amountCents: 40, feeCents: 1 }),
    ];
    const m = metricsOf(times, r, 0, 3, trades, 100);
    expect(m.cagr).toBeCloseTo(-0.01, 10);
    expect(m.maxDrawdown).toBeCloseTo(0.25, 10);
    // Paid 101 for one: 50.50 each half. The first half sold for 59 (a win), the second for 39.
    expect(m.winRate).toBe(0.5);
    expect(m.trades).toBe(3);
    expect(m.turnover).toBeCloseTo(2, 10);
    expect(m.costsCents).toBe(3);
  });
});

describe("holdReplay", () => {
  it("buys once at the first open after costs and never trades", () => {
    const btc = walkBars("BTC/USD", { from: "2025-01-01T00:00:00Z", count: 10, minutes: 60 });
    const tl = timelineOf({ "BTC/USD": btc }, "BTC/USD", "24h");
    const h = holdReplay("BTC/USD", tl, crypto);
    const qty = 1_000_000 / 1.0025 / (btc[0].o * 1.0003);
    expect(h.values.at(-1)).toBeCloseTo(qty * btc.at(-1)!.c, 6);
  });
});

describe("runGroup", () => {
  const btc = walkBars("BTC/USD", {
    from: "2024-01-01T00:00:00Z",
    count: 2_400,
    minutes: 60,
    vol: 0.012,
    drift: 0.0001,
  });
  const eth = walkBars("ETH/USD", {
    from: "2024-01-01T00:00:00Z",
    count: 2_400,
    minutes: 60,
    vol: 0.015,
  });
  const tl = timelineOf({ "BTC/USD": btc, "ETH/USD": eth }, "BTC/USD", "24h");
  const policies = policiesFor("crypto");
  const group = runGroup("crypto", "1h", policies, tl, crypto, crypto.cash, crypto.hold, 60)!;

  it("scores every policy out of sample, against just holding", () => {
    expect(group.results).toHaveLength(policies.length);
    expect(group.from).toBe(tl.times[Math.floor(tl.times.length * AGENT_TRAIN_SHARE)]);
    for (const r of group.results) {
      expect(r.walk.from).toBe(group.from);
      // Each rule against holding its own asset: ether's rules against ether.
      const own = policies.find((p) => p.key === r.key)!.hold ?? crypto.hold;
      if (own === crypto.hold) expect(r.hold).toEqual(group.hold);
      else expect(r.hold.cagr).not.toBe(group.hold.cagr);
      expect(r.chosen).toHaveLength(3);
      expect(r.dsr).toBeGreaterThanOrEqual(0);
      expect(r.dsr).toBeLessThanOrEqual(1);
      expect(r.excessCagr).toBeCloseTo(r.walk.cagr - r.hold.cagr, 12);
      if (r.walk.cagr < 0) expect(r.verdict).toBe("loses_money");
      if (r.verdict === "beats_hold") expect(r.walk.cagr).toBeGreaterThan(r.hold.cagr);
    }
  });

  it("asks more of each strategy the more were tried", () => {
    const more = runGroup("crypto", "1h", policies, tl, crypto, crypto.cash, crypto.hold, 60, {
      extraTrials: 1_000,
    })!;
    expect(more.trials).toBe(group.trials + 1_000);
    for (const r of more.results) {
      const base = group.results.find((x) => x.key === r.key)!;
      expect(r.dsr).toBeLessThanOrEqual(base.dsr + 1e-12);
    }
  });

  it("chooses each fold's setting from the bars before it only", () => {
    // Different bars after the first fold starts change nothing chosen for that fold.
    const s0 = Math.floor(tl.times.length * AGENT_TRAIN_SHARE);
    const other = walkBars("OTHER", {
      from: "2024-01-01T00:00:00Z",
      count: 2_400,
      minutes: 60,
      vol: 0.03,
    });
    const changed = btc.map((b, i) =>
      i <= s0 ? b : { ...b, o: other[i].o, h: other[i].h, l: other[i].l, c: other[i].c },
    );
    const g2 = runGroup(
      "crypto",
      "1h",
      policies,
      timelineOf({ "BTC/USD": changed, "ETH/USD": eth }, "BTC/USD", "24h"),
      crypto,
      crypto.cash,
      crypto.hold,
      60,
    )!;
    for (const r of g2.results)
      expect(r.chosen[0]).toBe(group.results.find((x) => x.key === r.key)!.chosen[0]);
  });

  it("needs enough bars", () => {
    const few = timelineOf({ "BTC/USD": btc.slice(0, 150) }, "BTC/USD", "24h");
    expect(
      runGroup("crypto", "1h", policies, few, crypto, crypto.cash, crypto.hold, 60),
    ).toBeNull();
  });
});
