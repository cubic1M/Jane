import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { premiumTotalLine } from "./policies";

// The total over /insurance's policies counts confirmed ones only, and says so.
const geico = {
  status: "active" as const,
  premiumCents: 14_200,
  premiumFrequency: "monthly" as const,
};
const asurion = {
  status: "found" as const,
  premiumCents: 1_700,
  premiumFrequency: "monthly" as const,
};

describe("premiumTotalLine", () => {
  it("adds up the confirmed policies", () => {
    expect(premiumTotalLine([geico])).toBe(
      "Together about $1,704.00 a year, from the prices on file.",
    );
  });

  it("says when policies found from payments aren't counted yet", () => {
    expect(premiumTotalLine([geico, asurion])).toBe(
      "The ones you've confirmed come to about $1,704.00 a year, from the prices on file. Confirm the others to count them.",
    );
  });

  it("is empty when nothing is confirmed", () => {
    expect(premiumTotalLine([asurion])).toBeNull();
    expect(premiumTotalLine([])).toBeNull();
  });
});
