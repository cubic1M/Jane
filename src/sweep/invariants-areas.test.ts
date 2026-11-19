import { describe, expect, it } from "vitest";
import { areaCounts } from "./invariants";

// The area-counts rule (class 3, debug3-invariants.md) on a tree written out as the snapshot reads
// it: items under branches, each branch's line and status, the tree's line, and Home's tile.

const tree = (overrides: Record<string, unknown> = {}) => ({
  "trees.money.tree.sub": "1 urgent · 2 to look at",
  "trees.money.tree.branches.charges.status": "act",
  "trees.money.tree.branches.charges.line": "1 urgent · 1 thing to look at",
  "trees.money.tree.branches.charges.items.fees.status": "act",
  "trees.money.tree.branches.charges.items.twice.status": "look",
  "trees.money.tree.branches.coming.status": "look",
  "trees.money.tree.branches.coming.line": "1 thing to look at",
  "trees.money.tree.branches.coming.items.low.status": "look",
  "trees.money.tree.branches.coming.items.week.status": "good",
  "tiles.money.health": "act",
  "tiles.money.healthWhy": "1 urgent · 2 to look at",
  ...overrides,
});

describe("an area's counts", () => {
  it("hold when every line is its items counted and the tile says the page's status", () => {
    expect(areaCounts(tree())).toEqual([]);
  });

  it("catch a branch whose urgent item hides its things to look at (#2101)", () => {
    expect(areaCounts(tree({ "trees.money.tree.branches.charges.line": "1 urgent" }))).toEqual([
      'trees.money.tree.branches.charges.line: "1 urgent", its items: 1 urgent, 1 to look at',
    ]);
  });

  it("catch a tree's line that doesn't add up its branches", () => {
    expect(areaCounts(tree({ "trees.money.tree.sub": "1 urgent · 1 to look at" }))).toEqual([
      'trees.money.tree.sub: "1 urgent · 1 to look at", its items: 1 urgent, 2 to look at',
    ]);
  });

  it("catch a tile saying all's good over a page with things to look at", () => {
    expect(
      areaCounts(tree({ "tiles.money.health": "good", "tiles.money.healthWhy": "All good" })),
    ).toEqual(['tiles.money.health: good ("All good"), its page: act ("1 urgent · 2 to look at")']);
  });

  it("catch a branch marked better than its worst item", () => {
    expect(areaCounts(tree({ "trees.money.tree.branches.coming.status": "good" }))).toEqual([
      "trees.money.tree.branches.coming.status: good, its items' worst: look",
    ]);
  });

  it("let a quiet area say All good", () => {
    expect(
      areaCounts({
        "trees.taxes.tree.sub": "All good",
        "trees.taxes.tree.branches.profile.status": "good",
        "trees.taxes.tree.branches.profile.items.filing.status": "good",
        "tiles.taxes.health": "good",
      }),
    ).toEqual([]);
  });
});
