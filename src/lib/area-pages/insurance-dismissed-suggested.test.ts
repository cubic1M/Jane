import { describe, expect, it } from "vitest";
import { insuranceTree, type InsuranceTreeInput } from "./insurance";

// Debug 2, sixth desktop sweep (11-18, upload S5): after "I don't need it" on "No renters insurance
// on file.", Insurance still listed "Renters insurance, Check it: You rent and I see no
// renters-cover charge in 1 months." from the open "Note no renters cover" suggestion. A cover the
// person said they don't need isn't brought back by a suggestion about it.

const input = (dismissed: string[]): InsuranceTreeInput => ({
  asOf: "2026-11-18",
  needs: [],
  policies: [],
  gaps: [],
  savings: [],
  renewals: [],
  changes: [],
  readings: [],
  payingTwice: [],
  cards: [],
  household: [],
  risks: [],
  health: null,
  suggested: [{ topic: "belongings_cover", short: "You rent and I see no renters-cover charge." }],
  dismissed,
});
const ids = (dismissed: string[]) =>
  insuranceTree(input(dismissed)).tree.branches.flatMap((b) => b.items.map((i) => i.id));

describe("a suggestion about cover the person said they don't need", () => {
  it("doesn't list it as missing", () => {
    expect(ids(["renters"])).not.toContain("missing:renters");
  });

  it("does while they haven't said so", () => {
    expect(ids([])).toContain("missing:renters");
  });
});
