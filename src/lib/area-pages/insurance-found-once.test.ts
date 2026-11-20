import { describe, expect, it } from "vitest";
import { insuranceTree, type InsuranceTreeInput } from "./insurance";

// Debug 2, desktop sweep 9 (11-19, Plaid sandbox + loans: a car loan, and Progressive $154.99 a
// month in the payments): Insurance listed "Car insurance, Confirm it: Progressive is in your
// payments. Confirm it so it counts." and, under it, "Progressive car, $1.9k/yr: Found from your
// payments; confirm it to count it." One policy, asked about twice.

const progressive = {
  id: "prog",
  kind: "auto",
  carrier: "Progressive",
  status: "found",
  yearlyCents: 185_988,
  renewsOn: null,
} as unknown as InsuranceTreeInput["policies"][number];
const input = (policies: InsuranceTreeInput["policies"]) =>
  ({
    asOf: "2026-11-19",
    needs: [],
    policies,
    gaps: [
      {
        key: "auto",
        why: "You have a car loan, and there's no car policy on file.",
        policyId: null,
      },
    ],
    savings: [],
    renewals: [],
    changes: [],
    readings: [],
    payingTwice: [],
    cards: [],
    household: [],
    risks: [],
    health: null,
  }) as unknown as InsuranceTreeInput;
const said = (policies: InsuranceTreeInput["policies"]) => {
  const { tree, summaries } = insuranceTree(input(policies));
  return tree.branches.flatMap((b) => b.items).map((i) => summaries[i.id] ?? "");
};

describe("car cover found in the payments", () => {
  it("is asked about once, on the gap that asks to confirm it", () => {
    const lines = said([progressive]);
    expect(lines.filter((l) => /confirm it/i.test(l))).toEqual([
      "Progressive is in your payments. Confirm it so it counts.",
    ]);
  });

  it("is still a gap when nothing is found", () => {
    expect(said([])).toContain("You have a car loan, and there's no car policy on file.");
  });
});
