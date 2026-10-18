import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PFC_TAXONOMY } from "@/categorize/taxonomy";
import { categoryOptions, detailedLabel } from "./categories";

describe("category names", () => {
  it("reads Plaid's detailed names plainly", () => {
    expect(detailedLabel("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES")).toBe("Groceries");
    expect(detailedLabel("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY")).toBe(
      "Gas and electricity",
    );
  });

  it("offers every category exactly once", () => {
    const offered = categoryOptions().flatMap((g) => g.options.map((o) => o.value));
    expect(offered.sort()).toEqual(Object.values(PFC_TAXONOMY).flat().sort());
  });
});
