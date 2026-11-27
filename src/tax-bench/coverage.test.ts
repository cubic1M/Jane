import { describe, expect, it } from "vitest";
import { SUPPORTED_TAX_YEARS } from "@/config/tax-params";
import { FIGURE_IDS } from "./figures";
import { ESTIMATOR_YEARS, loadCases } from "./serialize";

// "No figure ships without a case" (Tax T2).

describe("every year the parameters cover", () => {
  it.each(SUPPORTED_TAX_YEARS)("%i has bench cases", (year) => {
    expect(
      loadCases(year).length,
      `add bench cases for ${year} (src/tax-bench/cases/${year})`,
    ).toBeGreaterThan(0);
  });
});

describe.each(ESTIMATOR_YEARS)("every figure of the estimate has a case, %i", (year) => {
  const cases = loadCases(year);

  it.each(FIGURE_IDS)("%s", (id) => {
    const using = cases.filter((c) => id in c.expected).map((c) => c.id);
    expect(using, `no ${year} bench case checks ${id}: add one`).not.toEqual([]);
  });

  it("is not satisfied only by cases that are expected to fail", () => {
    for (const id of FIGURE_IDS) {
      const passing = cases.filter(
        (c) => id in c.expected && !c.expectedFailure?.figures.includes(id),
      );
      expect(passing.length, `${id} is checked only by expected failures`).toBeGreaterThan(0);
    }
  });
});
