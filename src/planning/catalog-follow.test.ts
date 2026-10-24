import { describe, expect, it } from "vitest";
import { TARGET_MIXES } from "@/config/investing";
import { catalogTickers } from "@/config/strategy-catalog";
import type { Bar } from "@/lib/market/types";
import { alignCatalog } from "./catalog/engine";
import { catalogTargets, planTargets } from "./catalog-follow";
import type { LedgerState } from "./practice-ledger";

// Following a tested strategy: the research's own rule at the last month-end, as shares of the
// whole portfolio, and the trades that bring the portfolio to them within the hard limits.

function universe() {
  const dates: string[] = [];
  for (let d = Date.parse("2024-01-02"); d <= Date.parse("2026-10-23"); d += 86_400_000) {
    const day = new Date(d).getUTCDay();
    if (day !== 0 && day !== 6) dates.push(new Date(d).toISOString().slice(0, 10));
  }
  const bars: Record<string, Bar[]> = {};
  for (const [i, t] of catalogTickers().entries())
    bars[t] = dates.map((date, k) => ({
      date,
      closeCents: Math.round(
        10_000 * (1 + 0.0002 * (i % 7) - 0.0001) ** k * (1 + 0.01 * Math.sin(k / (5 + i))),
      ),
    }));
  return alignCatalog(bars)!;
}

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, x) => a + x, 0);

describe("catalogTargets", () => {
  const u = universe();

  it("a whole portfolio: the rule's funds as of the month before, blended with bills", () => {
    const f = catalogTargets("haa", 4, u, 3)!;
    expect(sum(f.targets)).toBeCloseTo(1, 6);
    expect(f.k).toBeGreaterThan(0);
    expect(f.k).toBeLessThanOrEqual(1);
    expect(f.signalDate).toBe("2026-09-30");
  });

  it("an equity strategy takes only the mix's US-stocks share", () => {
    const f = catalogTargets("sector_rotation", 6, u, 3)!;
    expect(sum(f.targets)).toBeCloseTo(1, 6);
    expect(f.targets.VXUS).toBeCloseTo(TARGET_MIXES[3].intl_stocks, 6);
    expect(f.targets.BND).toBeCloseTo(TARGET_MIXES[3].bonds, 6);
    expect(f.targets.VTI).toBeUndefined();
  });

  it("an overlay moves the mix's funds to bills fund by fund", () => {
    const f = catalogTargets("mix_trend_overlay", 10, u, 3)!;
    expect(sum(f.targets)).toBeCloseTo(1, 6);
    for (const x of Object.keys(f.targets)) expect(["VTI", "VXUS", "BND", "BIL"]).toContain(x);
  });

  it("waits without a year of closes before the month", () => {
    const short = {
      ...u,
      dates: u.dates.slice(0, 120),
      closes: Object.fromEntries(Object.entries(u.closes).map(([x, c]) => [x, c.slice(0, 120)])),
    };
    expect(catalogTargets("haa", 4, short, 3)).toBeNull();
  });
});

describe("planTargets", () => {
  const prices = {
    VTI: 10_000,
    BND: 10_000,
    BIL: 10_000,
    TLT: 10_000,
    GLD: 10_000,
    NVDA: 10_000,
    BTCUSD: 10_000,
  };
  const state: LedgerState = {
    cashCents: 0,
    positions: {
      VTI: { quantity: 60, costBasisCents: 600_000 },
      BND: { quantity: 30, costBasisCents: 300_000 },
      NVDA: { quantity: 1, costBasisCents: 10_000 },
      BTCUSD: { quantity: 2, costBasisCents: 20_000 },
    },
  };
  const run = (targets: Record<string, number>) =>
    planTargets({
      label: "Test",
      targets,
      signalDate: "2026-09-30",
      state,
      prices,
      cashBufferCents: 0,
      tradesToday: 0,
    });

  it("sells what the rule doesn't hold, buys what it does, sells first, from the cash freed", () => {
    const t = run({ TLT: 0.5, GLD: 0.5 });
    expect(
      t
        .filter((x) => x.side === "sell")
        .map((x) => x.ticker)
        .sort(),
    ).toEqual(["BND", "VTI"]);
    const buys = t.filter((x) => x.side === "buy");
    expect(buys.map((x) => x.ticker).sort()).toEqual(["GLD", "TLT"]);
    const freed = t.filter((x) => x.side === "sell").reduce((a, x) => a + x.amountCents, 0);
    expect(buys.reduce((a, x) => a + x.amountCents, 0)).toBeLessThanOrEqual(freed);
    for (const x of t) expect(x.rule).toBe("catalog_follow");
    // A company's shares and the crypto sleeve are left alone.
    expect(t.some((x) => x.ticker === "NVDA" || x.ticker === "BTCUSD")).toBe(false);
  });

  it("never more than the per-fund limit in one, bills excepted; small gaps wait", () => {
    const t = run({ TLT: 1 });
    const tlt = t.find((x) => x.ticker === "TLT" && x.side === "buy")!;
    expect(tlt.amountCents).toBeLessThanOrEqual(Math.round(0.8 * 920_000) + 1);
    expect(run({ VTI: 600_000 / 920_000, BND: 300_000 / 920_000, BIL: 20_000 / 920_000 })).toEqual(
      [],
    );
  });
});
