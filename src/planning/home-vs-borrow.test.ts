import { describe, expect, it } from "vitest";
import { homeVsBorrow, homeVsBorrowClause } from "./home-vs-borrow";

// Loans QA: the two home-loan sizes are always shown together, with why they differ.
describe("a home by the 28/36 rules against what you could borrow", () => {
  it("names both sizes and what each measures in one sentence", () => {
    // Sam: a $450,000 home by the 28/36 rules, a $324,000 mortgage on a comfortable payment.
    expect(homeVsBorrow({ maxPriceCents: 45_000_000, downShare: 0.1 }, 32_400_000)).toBe(
      "Two measures, two sizes: the usual 28/36 rules on your gross pay put a home at about $450,000.00 (a $405,000.00 loan with 10% down, taxes and insurance counted), while keeping the mortgage payment to a comfortable 30% of your take-home, inside what lenders allow, borrows about $324,000.00.",
    );
  });

  it("says nothing when one is missing or they agree", () => {
    expect(homeVsBorrow(null, 32_400_000)).toBeNull();
    expect(homeVsBorrow({ maxPriceCents: 45_000_000, downShare: 0.1 }, null)).toBeNull();
    expect(homeVsBorrow({ maxPriceCents: 45_000_000, downShare: 0.1 }, 40_000_000)).toBeNull();
  });

  it("has a clause for an answer that already says the home", () => {
    expect(homeVsBorrowClause({ maxPriceCents: 45_000_000, downShare: 0.1 }, 32_400_000)).toBe(
      "keeping the mortgage payment to a comfortable 30% of your take-home, rather than the 28/36 rules on your gross pay, borrows about $324,000.00 instead",
    );
    expect(
      homeVsBorrowClause({ maxPriceCents: 45_000_000, downShare: 0.1 }, 40_000_000),
    ).toBeNull();
  });
});
