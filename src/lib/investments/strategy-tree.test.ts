import { describe, expect, it } from "vitest";
import { CATALOG, CATALOG_IDS } from "@/config/strategy-catalog";
import { strategyBoard, type BoardInput } from "./strategy-board";
import {
  FAMILIES,
  LEAF_GLYPHS,
  LEAF_TAGS,
  branchesOf,
  familyOf,
  leafFigure,
  levelTiles,
  strategyTree,
} from "./strategy-tree";

// The strategy tree: levels as tiles, families as branches, strategies as leaves, every leaf
// once, day trading and crypto only at Very high.

const input: Omit<BoardInput, "level"> = {
  yourLevel: 3,
  choice: "level",
  catalog: null,
  crypto: null,
  dayTrading: null,
};

describe("the strategy tree", () => {
  it("puts every strategy at a level in exactly one family, in family order", () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      const board = strategyBoard({ ...input, level });
      const branches = branchesOf(board);
      const keys = branches.flatMap((b) => b.leaves.map((l) => l.key));
      expect(keys.sort()).toEqual(board.rows.map((r) => r.key).sort());
      const order = Object.keys(FAMILIES);
      const seen = branches.map((b) => order.indexOf(b.key));
      expect([...seen].sort((a, b) => a - b)).toEqual(seen);
      expect(branches.some((b) => b.key === "speculative")).toBe(level === 5);
      for (const b of branches) expect(b.label).toBe(FAMILIES[b.key]);
    }
  });

  it("files strategies where a person would look for them", () => {
    expect(familyOf({ key: "catalog:sixty_forty" }, 3)).toBe("steady");
    expect(familyOf({ key: "catalog:risk_parity" }, 3)).toBe("steady");
    expect(familyOf({ key: "catalog:haa" }, 3)).toBe("trend");
    expect(familyOf({ key: "catalog:value" }, 3)).toBe("factor");
    expect(familyOf({ key: "catalog:sell_in_may" }, 3)).toBe("timing");
    expect(familyOf({ key: "crypto:crypto_trend" }, 5)).toBe("speculative");
    expect(familyOf({ key: "intraday:opening_range" }, 5)).toBe("speculative");
    // Jane's pick: the trend filter below Very high, the mix itself there.
    expect(familyOf({ key: "default" }, 3)).toBe("trend");
    expect(familyOf({ key: "default" }, 5)).toBe("steady");
    for (const id of CATALOG_IDS)
      expect(Object.keys(FAMILIES), `${id} (${CATALOG[id].family})`).toContain(
        familyOf({ key: `catalog:${id}` }, 3),
      );
  });

  it("gives every leaf a glyph, a short tag and its return a year", () => {
    expect(LEAF_TAGS).toEqual({
      default: "DEFAULT",
      recommended: "RECOMMENDED",
      watch: "WORTH WATCHING",
      tested: "NOT RECOMMENDED",
      lost: "LOST MONEY",
    });
    expect(new Set(Object.values(LEAF_GLYPHS)).size).toBe(5);
    expect(leafFigure({ cagr: 0.0771 })).toBe("+7.7%/yr");
    expect(leafFigure({ cagr: -0.08 })).toBe("−8.0%/yr");
  });

  it("opens on the person's own level, with what's worth watching on each tile", () => {
    const { tiles, board } = strategyTree(input);
    expect(board.level).toBe(3);
    expect(board.yours).toBe(true);
    expect(tiles.map((t) => t.label)).toEqual(["Very low", "Low", "Medium", "High", "Very high"]);
    expect(tiles.filter((t) => t.yours).map((t) => t.level)).toEqual([3]);
    for (const t of tiles) expect(t.count).toMatch(/^\d+ worth watching$/);
    expect(levelTiles(2)[0].count).toBe("");
  });
});
