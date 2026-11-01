import { describe, expect, it } from "vitest";
import { actionWorthCents, doneSummary } from "./saved-amount";

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

// Debugger 11-01: /jane's folded "Done" said "about $636.96 a year saved" the minute a card was
// marked done, while /saved said $0.00 verified and Home "Expected, not confirmed yet".
describe("doneSummary", () => {
  it("says the saved-to-date total is expected, not saved", () => {
    expect(doneSummary(63_696, 1)).toBe("about $636.96 a year expected");
    expect(doneSummary(0, 2)).toBe("2 finished");
    expect(doneSummary(0, 0)).toBe("nothing yet");
  });
});
