import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { coverageGaps } from "./gaps";
import { resolveHousehold, type AccountSigns } from "./household";

// Debugger 11-13, Insurance on a phone with the demo bank: "Your health plan this year" showed
// "Acme PPO (sample plan): you've met $500.00 of your $500.00 deductible", and two branches up
// "Health cover: Not on file … Get a health plan: compare marketplace plans". While the sample
// plan stands in for one, there's no "no health insurance" gap beside it.

const signs = (over: Partial<AccountSigns> = {}): AccountSigns => ({
  mortgage: false,
  homeOwned: false,
  rentPaid: true,
  cars: 0,
  paycheck: true,
  medicalCents: 54_936,
  ...over,
});
const healthGap = (over: Partial<AccountSigns>) =>
  coverageGaps(resolveHousehold(null, signs(over)), []).some((g) => g.key === "health");

describe("the health gap beside the demo bank's sample plan", () => {
  it("isn't there while the sample plan is the person's health plan", () => {
    expect(healthGap({ sampleHealthPlan: true })).toBe(false);
  });

  it("is there for anyone else with medical spending and no health plan on file", () => {
    expect(healthGap({})).toBe(true);
  });
});
