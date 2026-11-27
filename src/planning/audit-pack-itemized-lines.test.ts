import { describe, expect, it } from "vitest";
import { itemizedLineFigures } from "./audit-records";

// Gifts, mortgage interest and property tax in the audit pack: "Claimed" is what the estimate
// counts, as it is for medical costs.

const deduction = (
  kind: "standard" | "itemized",
  over: { charity?: number; mortgage?: number; nonItemizer?: number } = {},
) => ({
  kind,
  nonItemizerCharityCents: over.nonItemizer ?? 0,
  itemized: { charityCents: over.charity ?? 0, mortgageInterestCents: over.mortgage ?? 0 },
});

describe("itemized lines under the standard deduction", () => {
  it("claims nothing for mortgage interest and property tax, and says why", () => {
    for (const line of ["mortgage_interest", "property_tax"] as const) {
      const figures = itemizedLineFigures(
        line,
        900_000,
        deduction("standard", { mortgage: 900_000 }),
      );
      expect(figures.claimedCents).toBe(0);
      expect(figures.gross?.cents).toBe(900_000);
      expect(figures.gross?.label).toContain(
        "the standard deduction is larger, so none is claimed",
      );
    }
  });

  it("claims only the cash gifts the standard deduction allows", () => {
    expect(
      itemizedLineFigures("gifts", 150_000, deduction("standard", { nonItemizer: 100_000 })),
    ).toEqual({
      claimedCents: 100_000,
      gross: {
        label:
          "All gifts paid (the standard deduction is larger, so only the cash gifts it allows are claimed)",
        cents: 150_000,
      },
    });
    expect(itemizedLineFigures("gifts", 150_000, deduction("standard")).claimedCents).toBe(0);
  });
});

describe("itemized lines when the estimate itemizes", () => {
  it("claims what was paid when the estimate counts all of it", () => {
    expect(
      itemizedLineFigures(
        "mortgage_interest",
        900_000,
        deduction("itemized", { mortgage: 900_000 }),
      ),
    ).toEqual({
      claimedCents: 900_000,
    });
    expect(itemizedLineFigures("property_tax", 400_000, deduction("itemized"))).toEqual({
      claimedCents: 400_000,
    });
  });

  it("shows what was paid apart when the estimate counts less", () => {
    expect(
      itemizedLineFigures("gifts", 500_000, deduction("itemized", { charity: 300_000 })),
    ).toEqual({
      claimedCents: 300_000,
      gross: { label: "All gifts paid, more than the estimate counts", cents: 500_000 },
    });
  });
});
