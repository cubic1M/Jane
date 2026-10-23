import { describe, expect, it } from "vitest";
import { actionWorthCents } from "./saved-amount";

// One rule for what a finished action is worth (docs/feature-audit.md, cluster 9). /saved used
// to take the agreed price before the refund, everything else the refund first.
describe("actionWorthCents", () => {
  it("is the refund, else the agreed lower price, else the estimate", () => {
    expect(actionWorthCents({ refundCents: 3_400, confirmedAnnualCents: 12_000 }, 9_000)).toBe(
      3_400,
    );
    expect(actionWorthCents({ refundCents: null, confirmedAnnualCents: 12_000 }, 9_000)).toBe(
      12_000,
    );
    expect(actionWorthCents({ refundCents: null, confirmedAnnualCents: null }, 9_000)).toBe(9_000);
    expect(actionWorthCents({ refundCents: null, confirmedAnnualCents: null })).toBeNull();
  });
});
