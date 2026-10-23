import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { fundTarget } from "./emergency-fund";

// One emergency fund (docs/feature-audit.md, cluster 13): the cash page and the refund plan size
// it as the drafted goal does, from how the person is paid, not a flat three months.
describe("fundTarget", () => {
  it("is three months for steady pay, six for uneven pay, a starter buffer in debt trouble", () => {
    const steady = { pattern: "salary", debtTrouble: false, incomeCents: 500_000 };
    expect(fundTarget(200_000, steady)?.targetCents).toBe(600_000);
    expect(fundTarget(200_000, { ...steady, pattern: "uneven" })?.targetCents).toBe(1_200_000);
    expect(fundTarget(200_000, { ...steady, debtTrouble: true })?.kind).toBe("starter");
  });

  it("is three months without a profile, and nothing without spending", () => {
    expect(fundTarget(200_000, undefined)?.targetCents).toBe(600_000);
    expect(fundTarget(0, undefined)).toBeNull();
  });
});
