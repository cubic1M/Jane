import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { SAVERS_CREDIT_DETECTORS } from "./savers-credit";

// Debugger 11-16 (a student's checking linked through Plaid sandbox, phone): one of the day's three
// cards was "Check the 2027 Saver's Match, earn $6/yr", 45% sure. Near the top of the phase-out the
// match is a few dollars; below $50 a year it isn't offered.

const match = (monthlyIncome: number) => {
  const base = inputFor("renter");
  const data: ProfileInput = {
    ...base,
    today: "2026-11-16",
    told: { ...base.told, monthly_income: monthlyIncome, filing_status: "single" },
  };
  return (
    runDetectors({ profile: buildProfile(data), data }, SAVERS_CREDIT_DETECTORS).find(
      (s) => s.topic === "savers_match",
    ) ?? null
  );
};

describe("the Saver's Match near the top of its phase-out", () => {
  it("isn't offered for a few dollars a year", () => {
    // $2,256.41 a month take-home is about $35,200 a year: $300 under the $35,500 top, a $20 match.
    expect(match(225_641)).toBeNull();
  });

  it("is still offered when it's worth it", () => {
    // About $28,080: half way through $20,500-$35,500.
    expect(match(180_000)?.worthCents).toBeGreaterThanOrEqual(5_000);
  });
});
