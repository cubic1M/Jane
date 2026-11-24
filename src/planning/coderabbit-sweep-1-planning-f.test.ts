import { describe, expect, it } from "vitest";
import { checkNotice } from "./tax-notice";
import { residencePeriods } from "./tax-states";
import { compareStudentPlans, rapPaymentCents, type StudentInput } from "./student-loans";

// CodeRabbit sweep, part 1 (money figures), src/planning chunk 8: each case is a finding
// reproduced against the code first (failing), then fixed.

const input = (over: Partial<StudentInput> = {}): StudentInput => ({
  balanceCents: 1_834_500,
  aprBps: 525,
  currentPaymentCents: 19_500,
  agiCents: 5_000_000,
  familySize: 1,
  dependants: 0,
  borrower: "new",
  publicService: false,
  paymentsCounted: 0,
  ...over,
});

describe("RAP: the principal drop is never more than what was paid", () => {
  it("a $10 payment on $20,000 at 6% drops principal $10 a month, not $50", () => {
    const i = input({
      balanceCents: 2_000_000,
      aprBps: 600,
      currentPaymentCents: null,
      agiCents: 1_200_000,
    });
    expect(rapPaymentCents(i)).toBe(1_000);
    const rap = compareStudentPlans(i, { advice: false }).results.find((r) => r.plan === "rap")!;
    // 360 months at $10 a month is $3,600 off the principal; what's left is forgiven.
    expect(rap.forgivenCents).toBeGreaterThan(1_500_000);
  });
});

describe("where they lived in a year with no move in it", () => {
  const moves = [{ date: "2025-07-01", from: "CA", to: "NY" }];
  it("is the state they left, when they moved later", () => {
    expect(residencePeriods(2024, "NY", moves).map((p) => p.state)).toEqual(["CA"]);
  });
  it("is the state they're in now when there is no later move, and splits a year with a move", () => {
    expect(residencePeriods(2026, "NY", moves).map((p) => p.state)).toEqual(["NY"]);
    expect(residencePeriods(2025, "NY", moves).map((p) => p.state)).toEqual(["CA", "NY"]);
  });
});

describe("a notice's dates", () => {
  it("rejects a date that doesn't exist", () => {
    const out = checkNotice({ noticeDate: "2026-02-30" }, {}, { today: "2026-11-24" });
    expect(out.fields.noticeDate).toBeUndefined();
    const ok = checkNotice({ noticeDate: "2026-02-27" }, {}, { today: "2026-11-24" });
    expect(ok.fields.noticeDate).toBe("2026-02-27");
  });
});
