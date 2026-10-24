import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { MENU_EVIDENCE, MENU_EVIDENCE_RANGE } from "@/config/strategy-menu-evidence";
import { MENU_STRATEGY_IDS, SECTOR_ROTATION_TOP } from "@/config/strategy-menu";
import { realFixtureBars } from "@/lib/market/__fixtures__/real";
import type { Bar } from "@/lib/market/types";
import {
  alignMenu,
  menuReplay,
  menuResult,
  menuTickers,
  menuWeights,
  type MenuResult,
} from "./strategy-menu";

// The strategy menu's replays: weights known only from the closes before each day, every
// strategy and the level's mix from the same day, and the committed evidence (the menu's
// cards) the fixture's own. STRATEGY_MENU_WRITE=1 writes the evidence afresh.

const LEVELS = [1, 2, 3, 4, 5] as const;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

const row = (m: MenuResult) => ({
  cagr: r4(m.whole.cagr),
  maxDrawdown: r4(m.whole.maxDrawdown),
  vol: r4(m.whole.vol),
  sortino: r4(m.whole.sortino),
  laterCagr: r4(m.later.cagr),
  laterMaxDrawdown: r4(m.later.maxDrawdown),
  laterSortino: r4(m.later.sortino),
  mixCagr: r4(m.mix.whole.cagr),
  mixMaxDrawdown: r4(m.mix.whole.maxDrawdown),
  mixSortino: r4(m.mix.whole.sortino),
  mixLaterCagr: r4(m.mix.later.cagr),
  mixLaterSortino: r4(m.mix.later.sortino),
  fits: m.fits,
  curve: m.curve,
});

describe("menuWeights", () => {
  const day = (n: number) => new Date(Date.UTC(2020, 0, 1 + n)).toISOString().slice(0, 10);
  const bars: Record<string, Bar[]> = {};
  for (const [i, t] of menuTickers().entries())
    bars[t] = Array.from({ length: 200 }, (_, k) => ({
      date: day(k),
      closeCents: 100 + k * (i % 5) + (k % 3),
    }));
  const u = alignMenu(bars)!;

  it("adds up to the whole portfolio, at every level", () => {
    for (const id of [...MENU_STRATEGY_IDS, "mix" as const])
      for (const level of LEVELS) {
        const w = menuWeights(id, level, u, 150);
        expect(Object.values(w).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
        expect(Object.values(w).every((x) => x >= 0)).toBe(true);
      }
  });

  it("holds the level's US stocks share in the tilt's fund, or in the top sectors", () => {
    expect(menuWeights("value_tilt", 3, u, 150)).toMatchObject({ VTV: 0.4, VXUS: 0.2, BND: 0.35 });
    expect(menuWeights("value_tilt", 3, u, 150).VTI).toBeUndefined();
    const rotation = menuWeights("sector_rotation", 4, u, 150);
    const sectors = Object.keys(rotation).filter((t) => t.startsWith("XL"));
    expect(sectors).toHaveLength(SECTOR_ROTATION_TOP);
    for (const s of sectors) expect(rotation[s]).toBeCloseTo(0.5 / SECTOR_ROTATION_TOP, 9);
  });

  it("decides from the closes before the day: tomorrow's prices change nothing", () => {
    const later = {
      ...u,
      closes: Object.fromEntries(
        Object.entries(u.closes).map(([t, c]) => [t, c.map((x, k) => (k >= 150 ? x * 3 : x))]),
      ),
    };
    for (const id of MENU_STRATEGY_IDS)
      expect(menuWeights(id, 4, later, 150)).toEqual(menuWeights(id, 4, u, 150));
  });
});

describe("on real closes (the fixture)", () => {
  const u = alignMenu(realFixtureBars())!;

  it("starts every strategy and the mix on the same day", () => {
    const starts = new Set(
      [...MENU_STRATEGY_IDS, "mix" as const].map((id) => menuReplay(u, id, 3)!.path[0].date),
    );
    expect(starts.size).toBe(1);
  });

  it.runIf(process.env.STRATEGY_MENU_WRITE)("writes the evidence", () => {
    const first = menuReplay(u, "mix", 3)!;
    const lines = MENU_STRATEGY_IDS.map((id) => {
      const levels = LEVELS.map((l) => `    ${l}: ${JSON.stringify(row(menuResult(u, id, l)!))},`);
      return `  ${id}: {\n${levels.join("\n")}\n  },`;
    });
    writeFileSync(
      "src/config/strategy-menu-evidence.ts",
      `import type { RiskLevel } from "@/config/investing";
import type { MenuStrategyId } from "@/config/strategy-menu";

// The strategy menu on real closes (src/planning/strategy-menu.ts on the fixture in
// src/lib/market/__fixtures__/real, Yahoo Finance adjusted closes), for each strategy and level:
// over the whole replay and over the later years (from 2022), with the level's own mix over the
// same days; whether it fits the level's risk budget; and its equity curve from 100. Written by
// STRATEGY_MENU_WRITE=1 npx vitest run src/planning/strategy-menu.test.ts, which otherwise checks
// these are the fixture's own. A replay of the past, not a forecast. Fractions throughout.

export type MenuRecord = {
  cagr: number;
  maxDrawdown: number;
  vol: number;
  sortino: number;
  laterCagr: number;
  laterMaxDrawdown: number;
  laterSortino: number;
  mixCagr: number;
  mixMaxDrawdown: number;
  mixSortino: number;
  mixLaterCagr: number;
  mixLaterSortino: number;
  fits: boolean;
  curve: number[];
};

export const MENU_EVIDENCE_SOURCE = "Yahoo Finance adjusted daily closes";
export const MENU_EVIDENCE_RANGE = { from: "${first.path[0].date}", to: "${first.path.at(-1)!.date}" };

export const MENU_EVIDENCE: Readonly<Record<MenuStrategyId, Readonly<Record<RiskLevel, MenuRecord>>>> = {
${lines.join("\n")}
};
`,
    );
  });

  it.each(MENU_STRATEGY_IDS)("%s: the committed evidence is the replay's own", (id) => {
    for (const level of LEVELS) {
      const fresh = row(menuResult(u, id, level)!);
      const kept = MENU_EVIDENCE[id][level as RiskLevel];
      expect(kept.fits, `${id} ${RISK_LEVELS[level].label}`).toBe(fresh.fits);
      for (const k of [
        "cagr",
        "maxDrawdown",
        "vol",
        "sortino",
        "laterCagr",
        "mixCagr",
        "mixSortino",
      ] as const)
        expect(kept[k]).toBeCloseTo(fresh[k], 3);
      expect(kept.curve.length).toBe(fresh.curve.length);
    }
    expect(MENU_EVIDENCE_RANGE.from < MENU_EVIDENCE_RANGE.to).toBe(true);
  });
});
