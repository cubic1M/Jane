import { describe, expect, it } from "vitest";
import { listDoubles } from "./invariants";

// Class 7 inside a list (the manager, 11-20): the walkers' two Subscriptions columns, as main had
// them before #2147 and #2160.

const column = (
  items: Record<string, { label: string; figure: string; line?: string }>,
  summaries: Record<string, string>,
) => {
  const at = "trees.money.tree.branches.subscriptions";
  return {
    "trees.money.tree.sub": "Spending & bills",
    ...Object.fromEntries(
      Object.entries(items).flatMap(([id, i]) => [
        [`${at}.items.${id}.label`, i.label],
        [`${at}.items.${id}.figure`, i.figure],
        ...(i.line ? [[`${at}.items.${id}.line`, i.line]] : []),
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(summaries).map(([id, s]) => [`trees.money.summaries.${id}`, s]),
    ),
  };
};

describe("one column of an area page", () => {
  it("fails one subscription counted in two lines' figures (#2147)", () => {
    const flat = column(
      {
        "sub:cheaper": { label: "A cheaper plan, same service", figure: "$78/yr" },
        "subscriptions:merchant:netflix": { label: "Netflix", figure: "$186/yr" },
      },
      { "sub:cheaper": "Netflix has a Standard with ads plan for $7.99 a month." },
    );
    expect(listDoubles(flat)).toEqual([
      `trees.money.tree.branches.subscriptions.items.sub:cheaper: "A cheaper plan, same service $78/yr" counts Netflix, which "Netflix $186/yr" counts too`,
    ]);
  });

  it("fails a line that adds up the lines beside it (#2160)", () => {
    const flat = column(
      {
        "sub:review": { label: "Subscriptions to review", figure: "$169/yr" },
        "subscriptions:merchant:crunch fitness": { label: "Crunch Fitness", figure: "$360/yr" },
        "subscriptions:merchant:apple": { label: "Apple", figure: "$132/yr" },
      },
      { "sub:review": "You pay about $677.64 a year across 3 subscriptions." },
    );
    expect(listDoubles(flat)).toEqual([
      `trees.money.tree.branches.subscriptions.items.sub:review: "Subscriptions to review $169/yr" adds up 3 subscriptions, beside 2 of them by name`,
    ]);
  });

  it("fails two lines that add up the same bills (this week's in the next month's)", () => {
    const at = "trees.money.tree.branches.coming.items";
    expect(
      listDoubles({
        "trees.money.tree.sub": "Spending & bills",
        [`${at}.coming:week.label`]: "Bills this week",
        [`${at}.coming:week.figure`]: "$274",
        [`${at}.coming:week.line`]: "4 bills",
        [`${at}.coming:month.label`]: "The next month of bills",
        [`${at}.coming:month.figure`]: "$2.8k",
        [`${at}.coming:month.line`]: "16 bills",
      }),
    ).toEqual([
      `${at}.coming:week: "Bills this week $274" (4 bills) and "The next month of bills $2.8k" (16 bills) count the same bills`,
    ]);
  });

  it("passes this week's bills beside what comes after them", () => {
    const at = "trees.money.tree.branches.coming.items";
    expect(
      listDoubles({
        "trees.money.tree.sub": "Spending & bills",
        [`${at}.coming:week.label`]: "Bills this week",
        [`${at}.coming:week.figure`]: "$274",
        [`${at}.coming:week.line`]: "4 bills",
        [`${at}.coming:month.label`]: "After this week",
        [`${at}.coming:month.figure`]: "$2.5k",
        [`${at}.coming:month.line`]: "12 bills",
      }),
    ).toEqual([]);
  });

  it("passes each one said once, a count without a figure, and a line alone", () => {
    expect(
      listDoubles(
        column(
          {
            "subscriptions:merchant:crunch fitness": { label: "Crunch Fitness", figure: "$360/yr" },
            "subscriptions:merchant:apple": { label: "Apple", figure: "$132/yr" },
            "sub:all": {
              label: "All your regular charges",
              figure: "9 charges",
              line: "9 regular charges",
            },
          },
          {},
        ),
      ),
    ).toEqual([]);
    expect(
      listDoubles(
        column(
          { "sub:review": { label: "Subscriptions to review", figure: "$169/yr" } },
          { "sub:review": "You pay about $677.64 a year across 3 subscriptions." },
        ),
      ),
    ).toEqual([]);
  });
});
