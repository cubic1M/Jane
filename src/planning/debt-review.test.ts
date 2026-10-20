import { describe, expect, it } from "vitest";
import { reviewReason, type ReviewInput } from "./debt-review";

// Spec step 230: when the debt review is due.

const base: ReviewInput = {
  today: "2026-10-18",
  lastOn: "2026-03-01",
  lastKeys: ["account:a", "account:b"],
  lastPayCents: 200_000,
  keys: ["account:a", "account:b"],
  anyOverdue: false,
  payCents: 200_000,
};

describe("reviewReason", () => {
  it("does the first review once there is a debt, and none without one", () => {
    expect(reviewReason({ ...base, lastOn: null })).toBe("first");
    expect(reviewReason({ ...base, lastOn: null, keys: [] })).toBeNull();
  });
  it("is due once a year", () => {
    expect(reviewReason({ ...base, lastOn: "2025-10-18" })).toBe("yearly");
    expect(reviewReason({ ...base, lastOn: "2025-10-19" })).toBeNull();
  });
  it("is early after a missed payment, a new loan or a raise", () => {
    expect(reviewReason({ ...base, anyOverdue: true })).toBe("missed_payment");
    expect(reviewReason({ ...base, keys: [...base.keys, "account:c"] })).toBe("new_loan");
    expect(reviewReason({ ...base, payCents: 210_000 })).toBe("raise");
    expect(reviewReason({ ...base, payCents: 209_999 })).toBeNull();
  });
  it("never twice within a month, except for the yearly one", () => {
    const soon = { ...base, lastOn: "2026-10-01" };
    expect(reviewReason({ ...soon, anyOverdue: true })).toBeNull();
    expect(reviewReason({ ...soon, payCents: 300_000 })).toBeNull();
    expect(reviewReason({ ...soon, lastOn: "2025-10-01" })).toBe("yearly");
  });
  it("does not count a smaller paycheck or a paid-off loan", () => {
    expect(reviewReason({ ...base, payCents: 100_000 })).toBeNull();
    expect(reviewReason({ ...base, keys: ["account:a"] })).toBeNull();
  });
});
