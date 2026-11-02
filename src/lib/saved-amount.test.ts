import { describe, expect, it } from "vitest";
import { actionWorthCents, doneSummary, savedSoFarLine } from "./saved-amount";

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

// Debugger 11-02, on the sample person: /jane said "Saved so far (expected): about $488.88 a year"
// where Home said "Saved so far $489, confirmed in your transactions". $129 of it was one refund.
describe("what /jane says was saved", () => {
  it('says what the transactions confirm when they do, with no "a year"', () => {
    expect(doneSummary(48_888, 2, 48_888)).toBe("$488.88 confirmed");
    expect(savedSoFarLine(48_888, 48_888)).toBe(
      "Saved so far: $488.88, confirmed in your transactions",
    );
  });

  it("says apart what's still only expected", () => {
    expect(savedSoFarLine(60_000, 20_000)).toBe(
      "Saved so far: $200.00, confirmed in your transactions. About $400.00 more expected.",
    );
    expect(doneSummary(60_000, 2, 20_000)).toBe("$200.00 confirmed");
  });

  it("keeps calling it expected when nothing is confirmed yet", () => {
    expect(savedSoFarLine(63_696, 0)).toBe("Saved so far (expected): about $636.96 a year");
    expect(doneSummary(63_696, 1, 0)).toBe("about $636.96 a year expected");
    expect(savedSoFarLine(0, 0)).toBeNull();
  });
});
