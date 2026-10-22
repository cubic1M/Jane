import type { AssetClass } from "@/config/funds";

// Investing by your values (spec step 236): what a person can leave out of their funds, or
// lean towards, and the tagged stand-in funds that do it. Until a fund-data partner is
// connected these are made-up funds (sample data, not real funds), like the rest of
// src/config/funds.ts. Every figure here is shown to the person.

export const VALUES_EXCLUSIONS = {
  fossil_fuels: "Fossil fuels",
  weapons: "Weapons",
  tobacco: "Tobacco",
} as const;
export type Exclusion = keyof typeof VALUES_EXCLUSIONS;

export const VALUES_THEMES = {
  clean_energy: "Clean energy",
} as const;
export type Theme = keyof typeof VALUES_THEMES;

export type ValuesFund = {
  ticker: string;
  assetClass: Exclude<AssetClass, "other" | "cash">;
  excludes: readonly Exclusion[];
  themes: readonly Theme[];
  // How many companies (or bonds) it holds, for the diversification line.
  holdings: number;
  // The share of the plain index's market value this fund still holds (basis points).
  keptBps: number;
};

// The plain index funds (CORE_FUNDS) hold everything: they exclude nothing.
export const CORE_HOLDINGS: Record<
  ValuesFund["assetClass"],
  { holdings: number; keptBps: number }
> = {
  us_stocks: { holdings: 3_500, keptBps: 10_000 },
  intl_stocks: { holdings: 6_000, keptBps: 10_000 },
  bonds: { holdings: 10_000, keptBps: 10_000 },
};

export const VALUES_FUNDS: readonly ValuesFund[] = [
  {
    ticker: "KUFFX",
    assetClass: "us_stocks",
    excludes: ["fossil_fuels"],
    themes: [],
    holdings: 3_300,
    keptBps: 9_600,
  },
  {
    ticker: "KUSEX",
    assetClass: "us_stocks",
    excludes: ["fossil_fuels", "weapons", "tobacco"],
    themes: [],
    holdings: 3_150,
    keptBps: 9_400,
  },
  {
    ticker: "KUCEX",
    assetClass: "us_stocks",
    excludes: ["fossil_fuels", "weapons", "tobacco"],
    themes: ["clean_energy"],
    holdings: 240,
    keptBps: 2_000,
  },
  {
    ticker: "KISEX",
    assetClass: "intl_stocks",
    excludes: ["fossil_fuels", "weapons", "tobacco"],
    themes: [],
    holdings: 5_300,
    keptBps: 9_100,
  },
  {
    ticker: "KBSEX",
    assetClass: "bonds",
    excludes: ["fossil_fuels", "weapons", "tobacco"],
    themes: [],
    holdings: 8_700,
    keptBps: 9_500,
  },
];

export const VALUES_SOURCE = "Demo screened-fund tags (sample data, not real funds)";

// A theme fund is a tilt, not a replacement: at most this share of the asset class it sits
// in, so it can't make the whole class a handful of sectors.
export const THEME_TILT_SHARE = 0.2;

// A switch smaller than this isn't worth the trade.
export const VALUES_MIN_SWITCH_CENTS = 50_000;

export const VALUES_NOTE =
  "A screened fund leaves some companies out, so it holds fewer of them and can move differently from the plain index. It sits in the same kind of investment, so your stocks-and-bonds mix, and the risk that goes with it, doesn't change.";
