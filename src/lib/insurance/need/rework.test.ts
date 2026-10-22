import { describe, expect, it } from "vitest";
import { computeNeeds, openedGaps, type NeedInput } from "./index";

const input = (over: Partial<NeedInput> = {}): NeedInput => ({
  yearlyPayCents: 9_600_000,
  dependants: 0,
  mortgageCents: 0,
  otherDebtCents: 0,
  mortgageYearsLeft: null,
  savingsCents: 1_000_000,
  cashCents: 1_000_000,
  netWorthCents: 1_000_000,
  workLifeCoverCents: 0,
  policies: [],
  ...over,
});
const life = (n: NeedInput) => computeNeeds(n).find((x) => x.kind === "life");

describe("kept perfect (step 280)", () => {
  it("a new child opens the life-cover gap the same day", () => {
    expect(life(input({ dependants: 0 }))).toBeUndefined();
    expect(life(input({ dependants: 1 }))?.gapCents).toBeGreaterThan(0);
    const gaps = openedGaps(computeNeeds(input({ dependants: 1 })), ["new_baby"]);
    expect(gaps.find((g) => g.need.kind === "life")?.because).toBe("the new baby");
  });
  it("names only the gaps the event can change", () => {
    const gaps = openedGaps(computeNeeds(input({ dependants: 1 })), ["car_bought"]);
    expect(
      gaps.every((g) => ["auto_liability", "umbrella", "deductible"].includes(g.need.kind)),
    ).toBe(true);
  });
  it("shows nothing for no events, and never buys anything", () => {
    expect(openedGaps(computeNeeds(input({ dependants: 1 })), [])).toEqual([]);
  });
});
