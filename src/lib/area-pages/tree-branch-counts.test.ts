import { describe, expect, it } from "vitest";
import { buildAreaTree, urgentLine, type AreaItem } from "./tree";

// Debugger 11-19 (r354, Plaid S6 on a phone): Spending & bills said "1 urgent · 7 to look at",
// and its branches said "1 urgent", "1 thing to look at" and "3 things to look at". A branch with
// an urgent item dropped its own things to look at, so the branches never added up to the tree's
// count (Insurance did the same: "1 urgent · 3 to look at" over branches saying 1, 1 and 1 urgent).

const item = (id: string, status: AreaItem["status"]): AreaItem => ({
  id,
  label: id,
  status,
  summary: "A test.",
});

describe("an area tree's counts", () => {
  const { tree } = buildAreaTree({
    key: "money",
    label: "Spending & bills",
    sub: ({ urgent, look }) => urgentLine(urgent, look),
    branches: [
      {
        id: "charges",
        label: "Charges to look at",
        items: [item("twice", "act"), item("a", "look"), item("b", "look"), item("c", "look")],
      },
      { id: "coming", label: "Coming up", items: [item("d", "look"), item("e", "good")] },
      { id: "subs", label: "Subscriptions", items: [item("f", "look"), item("g", "look")] },
    ],
  });

  it("says a branch's things to look at beside its urgent one", () => {
    expect(tree.branches.find((b) => b.id === "charges")?.line).toBe("1 urgent · 3 to look at");
  });

  it("adds up across the branches to the tree's own line", () => {
    expect(tree.sub).toBe("1 urgent · 6 to look at");
    const looks = tree.branches.reduce(
      (sum, b) => sum + Number(/(\d+) (?:things? )?to look at/.exec(b.line ?? "")?.[1] ?? 0),
      0,
    );
    expect(looks).toBe(6);
  });
});
