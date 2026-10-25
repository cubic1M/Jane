import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { CATALOG, type CatalogFamily, type CatalogId } from "@/config/strategy-catalog";
import { STRATEGY_RESEARCH_CHOICE } from "@/config/strategies";
import {
  strategyBoard,
  type Board,
  type BoardInput,
  type BoardRow,
  type BoardStatus,
} from "./strategy-board";

// The investments page's strategy tree (founder: "you can click through the tree graphs
// showcasing the different strategies and choose which one you like. It should be very easy for
// the user to use"): the five risk levels as tiles, a level's strategy families as branches, and
// each family's strategies as leaves with a glyph, a tag and their return a year. Built on the
// strategy board (src/lib/investments/strategy-board.ts), so the graph and the tree read the same
// numbers. Pure.

export type FamilyKey = "steady" | "trend" | "factor" | "timing" | "speculative";

export const FAMILIES: Readonly<Record<FamilyKey, string>> = {
  steady: "Steady mixes",
  trend: "Trend & momentum",
  factor: "Factor tilts",
  timing: "Timing rules",
  speculative: "Day trading & crypto",
};
const FAMILY_ORDER: readonly FamilyKey[] = ["steady", "trend", "factor", "timing", "speculative"];

// The catalog's own families, grouped the way a person would look for them.
const FROM_CATALOG: Readonly<Record<CatalogFamily, FamilyKey>> = {
  static: "steady",
  risk: "steady",
  tactical: "trend",
  trend: "trend",
  rotation: "trend",
  combination: "trend",
  factor: "factor",
  protection: "timing",
  reversion: "timing",
  seasonal: "timing",
};

// Short tags and a glyph per status: shape and words, never colour.
export const LEAF_TAGS: Readonly<Record<BoardStatus, string>> = {
  default: "DEFAULT",
  recommended: "RECOMMENDED",
  watch: "WORTH WATCHING",
  tested: "NOT RECOMMENDED",
  lost: "LOST MONEY",
};
export const LEAF_GLYPHS: Readonly<Record<BoardStatus, string>> = {
  default: "■",
  recommended: "●",
  watch: "◐",
  tested: "○",
  lost: "▼",
};

export function familyOf(row: Pick<BoardRow, "key">, level: RiskLevel): FamilyKey {
  if (row.key === "default")
    return STRATEGY_RESEARCH_CHOICE[level].id === "static" ? "steady" : "trend";
  const [kind, id] = row.key.split(":");
  if (kind === "crypto" || kind === "intraday") return "speculative";
  return FROM_CATALOG[CATALOG[id as CatalogId].family];
}

export type TreeBranch = { key: FamilyKey; label: string; leaves: BoardRow[] };

// A level's branches, in family order, each leaf as the board orders them (the default first,
// then by status and Sortino). A family with nothing in it isn't drawn.
export function branchesOf(board: Pick<Board, "level" | "rows">): TreeBranch[] {
  return FAMILY_ORDER.flatMap((key) => {
    const leaves = board.rows.filter((r) => familyOf(r, board.level) === key);
    return leaves.length > 0 ? [{ key, label: FAMILIES[key], leaves }] : [];
  });
}

const pct = (n: number) =>
  `${n >= 0 ? "+" : "−"}${(Math.round(Math.abs(n) * 1000) / 10).toFixed(1)}%`;
export const leafFigure = (row: Pick<BoardRow, "cagr">) => `${pct(row.cagr)}/yr`;

export type LevelTile = {
  level: RiskLevel;
  label: string;
  line: string;
  yours: boolean;
  // What's worth watching there, in a few words.
  count: string;
};

export function levelTiles(
  yourLevel: RiskLevel,
  counts: Partial<Record<RiskLevel, number>> = {},
): LevelTile[] {
  return ([1, 2, 3, 4, 5] as const).map((level) => ({
    level,
    label: RISK_LEVELS[level].label,
    line: RISK_LEVELS[level].description,
    yours: level === yourLevel,
    count: counts[level] === undefined ? "" : `${counts[level]} worth watching`,
  }));
}

// The tree's first view: the person's own level, opened, with its board.
export function strategyTree(input: Omit<BoardInput, "level">) {
  const board = strategyBoard({ ...input, level: input.yourLevel });
  const counts = Object.fromEntries(
    ([1, 2, 3, 4, 5] as const).map((l) => [
      l,
      strategyBoard({ ...input, level: l }).rows.filter(
        (r) => r.status === "watch" || r.status === "recommended",
      ).length,
    ]),
  ) as Record<RiskLevel, number>;
  return { tiles: levelTiles(input.yourLevel, counts), board };
}
