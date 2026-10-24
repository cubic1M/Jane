import type { ThemeId } from "@/config/themes";

// Each news theme on its past events (src/config/themes.ts), from src/planning/themes.ts on the
// real closes in src/lib/market/__fixtures__/real (Yahoo Finance adjusted closes, 2016-01-04 to
// 2026-10-21): bought the day the news broke, out after THEME_HOLD_DAYS trading days or at the
// stop, after costs, against the whole US market (VTI) over the same days. Returns are
// fractions. `heldUp`: beat the market on average and in at least THEME_MIN_HIT_RATE of the
// events; a theme that didn't isn't offered. src/planning/themes.test.ts recomputes these from
// the fixture. A replay of the past, not a forecast. Re-run when an event list changes.

export type ThemeRecord = {
  events: number;
  hits: number;
  averageReturn: number;
  averageExcess: number;
  worst: number;
  best: number;
  heldUp: boolean;
};

export const THEME_EVIDENCE_SOURCE = "Yahoo Finance adjusted daily closes, 2016 to October 2026";

export const THEME_EVIDENCE: Readonly<Record<ThemeId, ThemeRecord>> = {
  middle_east_oil: {
    events: 9,
    hits: 1,
    averageReturn: -0.0224,
    averageExcess: -0.0463,
    worst: -0.0993,
    best: 0.0579,
    heldUp: false,
  },
  conflict_defense: {
    events: 7,
    hits: 5,
    averageReturn: 0.0371,
    averageExcess: 0.0141,
    worst: -0.0126,
    best: 0.0778,
    heldUp: true,
  },
  risk_off_gold: {
    events: 8,
    hits: 3,
    averageReturn: 0.0085,
    averageExcess: -0.0032,
    worst: -0.0831,
    best: 0.0568,
    heldUp: false,
  },
  rate_cut_bonds: {
    events: 11,
    hits: 5,
    averageReturn: 0.0042,
    averageExcess: 0.0086,
    worst: -0.1203,
    best: 0.1134,
    heldUp: false,
  },
  chip_boom: {
    events: 10,
    hits: 5,
    averageReturn: 0.0268,
    averageExcess: 0.012,
    worst: -0.0973,
    best: 0.1397,
    heldUp: true,
  },
};

// The other funds tested on the same events (THEMES[...].alternatives), shown beside each theme
// and never offered in its place.
export const THEME_ALTERNATIVE_EVIDENCE: readonly (ThemeRecord & {
  theme: ThemeId;
  ticker: string;
})[] = [
  {
    theme: "middle_east_oil",
    ticker: "USO",
    events: 9,
    hits: 2,
    averageReturn: -0.0233,
    averageExcess: -0.0508,
    worst: -0.0981,
    best: 0.1497,
    heldUp: false,
  },
  {
    theme: "risk_off_gold",
    ticker: "IEF",
    events: 8,
    hits: 2,
    averageReturn: 0.0114,
    averageExcess: 0.018,
    worst: -0.0143,
    best: 0.0472,
    heldUp: false,
  },
  {
    theme: "risk_off_gold",
    ticker: "TLT",
    events: 8,
    hits: 3,
    averageReturn: 0.0198,
    averageExcess: 0.0264,
    worst: -0.0424,
    best: 0.1054,
    heldUp: false,
  },
];

// How sure Jane is a theme's idea will beat the market this time: how often it did on its past
// events, pulled toward a coin flip because there are few of them ((hits + 1) / (events + 2)).
export function themeConfidence(r: Pick<ThemeRecord, "events" | "hits">): number {
  return Math.round((100 * (r.hits + 1)) / (r.events + 2));
}
