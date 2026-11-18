import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { runDetectors } from "./index";
import { STUDENT_MONEY_DETECTORS } from "./student-money";
import { grad } from "./__fixtures__/students";

// Debugger 11-18 (r348, Upload S2: BofA checking and a Chase card owing $1,240, no rate in the
// file, interest $40.86 and $43.95, on a phone): the report said "$84.81 in interest … could save
// about $339.24 a year" and the dock's "Pay off your card from cash" said it "stops about $396.87 a
// year of interest". One interest, two yearly figures: with no rate, the card says the report's.

const fire = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, STUDENT_MONEY_DETECTORS).find(
    (s) => s.topic === "card_from_cash",
  ) ?? null;

describe("card interest paid off from cash, with no rate from the bank", () => {
  it("is worth what the report says the card's interest is", () => {
    const base = grad();
    const noRate: ProfileInput = {
      ...base,
      liabilities: [],
      findings: [{ type: "card_interest", annualSavingsCents: 33_924, confidence: "medium" }],
    };
    const s = fire(noRate)!;
    expect(s).not.toBeNull();
    expect(s.headline).toMatch(/^Pay off your card from cash/);
    expect(s.worthCents).toBe(33_924);
    expect(s.why).toContain("stops about $339.24 a year");
  });
});
