import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { COVER_FACT_DETECTORS } from "./cover-facts";
import { INSURANCE_DETECTORS } from "./insurance";
import { runDetectors } from "./index";

// Debug 2's desktop walk, sweep 6 upload S5 (11-18): one month of Wells Fargo checking put "You
// rent and I see no renters-cover charge in 1 months." on Insurance. A month of data is "1 month".

const tx = (date: string, amountCents: number, description: string, pfc: string) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
const data: ProfileInput = {
  today: "2026-11-18",
  transactions: [
    tx("2026-10-16", -71_250, "CAMPUS DINING PAYROLL PPD", "INCOME_SALARY"),
    tx("2026-10-20", 3_720, "SAFEWAY #0921 DAVIS CA", "FOOD_AND_DRINK_GROCERIES"),
    tx("2026-10-30", -70_980, "CAMPUS DINING PAYROLL PPD", "INCOME_SALARY"),
    tx("2026-11-01", 85_000, "VENMO PAYMENT 1023 RENT ALEX K", "RENT_AND_UTILITIES_RENT"),
    tx("2026-11-13", -72_110, "CAMPUS DINING PAYROLL PPD", "INCOME_SALARY"),
  ],
  accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 64_218 }],
  liabilities: [],
  told: { insurance_home: false },
};

describe("a month of data", () => {
  it("is said as 1 month on the renters cards", () => {
    const profile = buildProfile(data);
    expect(profile.months).toBe(1);
    const found = runDetectors({ profile, data }, [
      ...COVER_FACT_DETECTORS,
      ...INSURANCE_DETECTORS,
    ]).filter((s) => s.topic === "belongings_cover" || s.topic === "renters_insurance");
    expect(found.length).toBeGreaterThan(0);
    for (const s of found) {
      expect(`${s.short} ${s.why}`).toContain("in 1 month.");
      expect(`${s.short} ${s.why}`).not.toMatch(/\b1 months\b/);
    }
  });
});
