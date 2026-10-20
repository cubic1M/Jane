import { describe, expect, it } from "vitest";
import { emergencyTarget } from "./emergency-fund";

// Spec step 263: the emergency fund is sized from the person, not three months for everyone.

const base = {
  spendingCents: 300_000,
  incomeCents: 400_000,
  pattern: "salary",
  debtTrouble: false,
};

describe("emergencyTarget", () => {
  it("is three months of spending for a steady salary", () => {
    expect(emergencyTarget(base)).toMatchObject({
      kind: "months",
      months: 3,
      targetCents: 900_000,
    });
  });
  it("is six months when income moves around", () => {
    for (const pattern of ["uneven", "business"]) {
      expect(emergencyTarget({ ...base, pattern })).toMatchObject({
        kind: "uneven",
        months: 6,
        targetCents: 1_800_000,
      });
    }
  });
  it("is a small starter buffer, not months, for someone in debt trouble", () => {
    const t = emergencyTarget({ ...base, debtTrouble: true })!;
    expect(t).toMatchObject({ kind: "starter", months: null, targetCents: 100_000 });
    expect(t.name).toMatch(/starter/i);
    // Even with uneven income.
    expect(emergencyTarget({ ...base, pattern: "uneven", debtTrouble: true })!.kind).toBe(
      "starter",
    );
  });
  it("is the gap between spending and a pension for a retiree, and nothing when income covers it", () => {
    expect(
      emergencyTarget({
        ...base,
        pattern: "pension",
        spendingCents: 450_000,
        incomeCents: 400_000,
      }),
    ).toMatchObject({ kind: "gap", targetCents: 50_000 * 12 });
    expect(
      emergencyTarget({
        ...base,
        pattern: "pension",
        spendingCents: 300_000,
        incomeCents: 452_000,
      }),
    ).toBeNull();
  });
  it("has nothing without spending", () => {
    expect(emergencyTarget({ ...base, spendingCents: 0 })).toBeNull();
  });
});
