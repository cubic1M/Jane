import { describe, expect, it } from "vitest";
import { DATED } from "./reasons";

// Code scanning (js/incomplete-sanitization, src/sweep/reasons.ts): a tree's count follows its
// own branches, matched by a pattern made from its path, and only the dots were escaped. A path
// with any other character a pattern reads (a "+", a backslash) matched other paths, or none.
const follows = DATED.find((r) => r.name === "a tree's items")!.follows!;

describe("a tree's count follows its own branches", () => {
  it("matches its own branches by their literal path", () => {
    const pattern = follows("trees.a+b.tree.sub");
    expect(pattern.test("trees.a+b.tree.branches.0")).toBe(true);
    expect(pattern.test("trees.aab.tree.branches.0")).toBe(false);
  });

  it("reads a backslash in the path as itself", () => {
    expect(follows("trees.a\\d.tree.sub").test("trees.a\\d.tree.branches.0")).toBe(true);
    expect(follows("trees.a\\d.tree.sub").test("trees.a7.tree.branches.0")).toBe(false);
  });

  it("still matches an ordinary tree's branches", () => {
    expect(follows("trees.money.tree.sub").test("trees.money.tree.branches.coming")).toBe(true);
    expect(follows("trees.money.tree.sub").test("trees.moneyXtree.branches.coming")).toBe(false);
  });
});
