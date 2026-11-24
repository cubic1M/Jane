import { describe, expect, it } from "vitest";
import { checkNotice } from "./tax-notice";
import { findTaxFacts } from "./tax-profile";
import { residencePeriods } from "./tax-states";

// CodeRabbit sweep, part 1 (money figures), src/planning chunk 8: each case is a finding
// reproduced against the code first (failing), then fixed.

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

describe("a move on January 1", () => {
  it("is living in the new state from the start of the year, with no state on the profile", () => {
    const periods = residencePeriods(2026, null, [{ date: "2026-01-01", from: "CA", to: "NY" }]);
    expect(periods.map((p) => [p.state, p.from])).toEqual([["NY", "2026-01-01"]]);
  });
  it("splits the rest of the year after a later move", () => {
    const periods = residencePeriods(2026, null, [
      { date: "2026-01-01", from: "CA", to: "NY" },
      { date: "2026-07-01", from: "NY", to: "NJ" },
    ]);
    expect(periods.map((p) => p.state)).toEqual(["NY", "NJ"]);
  });
});

describe("who a payment came from", () => {
  it("uses the description when the merchant name is blank", () => {
    const pay = (date: string) => ({
      date,
      amountCents: -245_000,
      pfcDetailed: "INCOME_SALARY",
      description: "ACME CORP PAYROLL",
      merchantName: "  ",
    });
    const found = findTaxFacts({
      transactions: [pay("2026-09-01"), pay("2026-09-15")],
      accounts: [],
      settingsState: null,
      newBaby: false,
    });
    expect(found.income.find((i) => i.kind === "w2")?.from).toEqual(["ACME CORP PAYROLL"]);
  });
});
