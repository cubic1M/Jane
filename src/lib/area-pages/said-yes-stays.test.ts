import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loansTree } from "./loans";

// Debugger 11-13: Yes on "Drop your mortgage insurance" opened /loans?focus=cheaper:pmi_removal,
// the step Jane prepared, but a suggestion answered yes was no longer drawn on the tree, so
// nothing opened and the student landed at the top of Loans. A suggestion said yes to stays on its
// area's tree, on their list: theirs to do now, not one more thing to look at.

const tree = (status?: string) =>
  loansTree({
    asOf: "2026-11-13",
    debts: [],
    suggestions: [
      {
        key: "debt:pmi_removal",
        topic: "pmi_removal",
        short: "Your mortgage of $312,400.00 carries PMI.",
        urgency: "later",
        worthCents: 156_200,
        worthKind: "saves",
        headline: "Drop your mortgage insurance, save $1,562 a year",
        ...(status ? { status } : {}),
      },
    ],
    installments: 0,
    payoff: null,
    credit: null,
    review: null,
  });

describe("a suggestion the person said yes to", () => {
  it("stays on the tree where its Yes lands, marked as on their list", () => {
    const { tree: t, chips } = tree("yes");
    const item = t.branches.flatMap((b) => b.items).find((i) => i.id === "cheaper:pmi_removal");
    expect(item).toMatchObject({ status: "good", badge: "On your list" });
    // Nothing more to look at, nothing urgent.
    expect(chips).toEqual([]);
  });

  it("is drawn as before while it waits for an answer", () => {
    const item = tree()
      .tree.branches.flatMap((b) => b.items)
      .find((i) => i.id === "cheaper:pmi_removal");
    expect(item?.status).toBe("look");
    expect(item?.badge).toBeUndefined();
  });
});
