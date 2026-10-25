import type { TreeStatus } from "@/components/tree/interactive-tree";
import { worst, type AreaTree } from "@/lib/area-pages/tree";
import type { AreaTrees } from "@/lib/giant-tree";
import type { AreaTile } from "./view";

// One status per area (QA round 11: the debt person's Insurance read "6 urgent" in the tree and
// "3 gaps" on its tile): the area's own tree, the one its page shows, decides it. Its worst
// branch is the status, and the tree's own line (`sub`, like "6 urgent · 3 to look at") says
// why. Home's tile and its "What Jane does" tree both read it from here.
export function areaStatus(area: AreaTree): { status: TreeStatus; why: string } {
  return {
    status: worst(area.tree.branches.map((b) => b.status)) ?? "good",
    why: area.tree.sub,
  };
}

// The tiles, each with its area's status from its tree when it has one.
export function withAreaStatus(tiles: readonly AreaTile[], trees: AreaTrees): AreaTile[] {
  return tiles.map((tile) => {
    const own = trees[tile.key];
    if (!own) return tile;
    const { status, why } = areaStatus(own);
    return { ...tile, health: status, healthWhy: why };
  });
}
