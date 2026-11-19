import { describe, expect, it } from "vitest";
import { DATED } from "./reasons";

// Home's tile says its area page's status and line (debug 3, 11-19, class 3), so the calendar
// sweep lets it move only with that area's own branches.
const reason = DATED.find((r) => r.name === "an area tile's tree")!;

describe("an area tile follows its own tree", () => {
  it("covers the tile's health and line", () => {
    expect(reason.paths.test("tiles.money.health")).toBe(true);
    expect(reason.paths.test("tiles.money.healthWhy")).toBe(true);
    expect(reason.paths.test("tiles.money.value")).toBe(false);
  });

  it("follows that area's branches, not another's", () => {
    const follows = reason.follows!("tiles.money.healthWhy");
    expect(follows.test("trees.money.tree.branches.coming.items.low.status")).toBe(true);
    expect(follows.test("trees.taxes.tree.branches.profile.status")).toBe(false);
  });
});
