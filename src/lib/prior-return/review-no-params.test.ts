import { describe, expect, it, vi } from "vitest";

// Tax T4: a confirmed return of a year Jane has no IRS figures for gets the W-N sentence and no
// review figures; a return of a year it has figures for is still reviewed.
const { loadTaxEstimate } = vi.hoisted(() => ({ loadTaxEstimate: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: () => ({
    taxAmendments: { findFirst: async () => null },
    taxProfiles: { findFirst: async () => null },
  }),
}));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: async () => true }));
vi.mock("@/lib/prior-return", () => ({
  listPriorReturns: async () => [
    { id: "old", year: 2024, fields: {} },
    { id: "ok", year: 2025, fields: {} },
  ],
}));
vi.mock("@/lib/tax-estimate", () => ({ loadTaxEstimate }));
vi.mock("@/lib/tax-residency", () => ({
  loadToldResidency: async () => ({ allowed: true, kind: "resident" }),
}));
vi.mock("@/lib/tax-organizer", () => ({
  loadTaxTags: async () => ({ tagged: [], totals: { childcare: { totalCents: 0 } } }),
}));
vi.mock("@/lib/tax-documents", () => ({ loadTaxDocuments: async () => ({ forms: [] }) }));
vi.mock("@/lib/family-taxes", () => ({ childrenOrUnknownAges: () => [] }));
vi.mock("@/lib/today", () => ({ todayOf: async () => "2026-11-27" }));
vi.mock("@/planning/prior-return", () => ({
  reviewReturn: () => ({ year: 2025, findings: [] }),
}));

import { loadReturnReviews } from "./review";

describe("the return review for a year with no IRS figures", () => {
  it("says so for 2024 and does not load its estimate; 2025 is reviewed", async () => {
    loadTaxEstimate.mockResolvedValue({
      input: { filingStatus: "single", childrenUnder17: 0, studentLoanInterestCents: 0 },
    });
    const { reviews, noParams } = await loadReturnReviews("u1");
    expect(noParams).toEqual([
      {
        returnId: "old",
        year: 2024,
        text: "Jane doesn't have the IRS figures for 2024 yet, so it isn't estimating that year.",
      },
    ]);
    expect(loadTaxEstimate).toHaveBeenCalledTimes(1);
    expect(loadTaxEstimate.mock.calls[0]![1]).toMatchObject({ year: 2025 });
    expect(reviews.map((r) => r.returnId)).toEqual(["ok"]);
  });
});
