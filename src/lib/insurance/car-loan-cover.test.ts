import { describe, expect, it } from "vitest";
import { insuranceTree } from "@/lib/area-pages/insurance";
import { coverageGaps } from "./gaps";
import { resolveHousehold } from "./household";

// Debugger 11-16 (a Plaid sandbox bank with a car loan): Insurance read "Car insurance, Missing",
// urgent, "Almost every state requires car insurance to drive." A financed car is insured under
// the loan's terms, so cover not seen is likely paid somewhere Jane can't see, as a mortgage's
// home cover is from escrow; the auto_insurance card already stays quiet then. It's "Not on file",
// worth a look, and says why.

const household = (carLoan: boolean) =>
  resolveHousehold(null, {
    mortgage: false,
    homeOwned: false,
    rentPaid: false,
    cars: 1,
    paycheck: true,
    ...(carLoan ? { carLoan: true } : {}),
  });

const carGap = (carLoan: boolean) =>
  coverageGaps(household(carLoan), []).find((g) => g.key === "auto");

const treeItem = (carLoan: boolean) =>
  insuranceTree({
    asOf: "2026-11-16",
    needs: [],
    policies: [],
    gaps: [carGap(carLoan)!],
    savings: [],
    renewals: [],
    changes: [],
    readings: [],
    payingTwice: [],
    cards: [],
    household: [],
    risks: [],
    health: null,
  })
    .tree.branches.flatMap((b) => b.items)
    .find((i) => i.id === "missing:auto")!;

describe("a car with a loan and no car policy on file", () => {
  it("is cover likely paid elsewhere, not urgent and missing", () => {
    const gap = carGap(true)!;
    expect(gap.likelyElsewhere).toBe(true);
    expect(gap.why).toContain("The lender requires cover");
    expect(treeItem(true)).toMatchObject({ status: "look", figure: "Not on file" });
  });

  it("stays urgent and missing for a car with no loan", () => {
    expect(carGap(false)!.likelyElsewhere).toBeUndefined();
    expect(treeItem(false)).toMatchObject({ status: "act", figure: "Missing" });
  });
});
