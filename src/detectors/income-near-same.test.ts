import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { SAVERS_CREDIT_DETECTORS } from "./savers-credit";
import { STUDENT_CREDIT_DETECTORS } from "./student-credits";
import { runDetectors } from "./index";

// Debug 2's desktop walk, sweep 6 upload S5 (11-18): one month of Wells Fargo checking put the
// Saver's Credit at "income near $29,933.59" and California's renter's credit at "income near
// $29,933.53" side by side in the dock. The same pay, rounded on two paths, is one figure.

const tx = (date: string, amountCents: number, description: string, pfc: string | null) => ({
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
    tx("2026-10-18", 2_122, "STARBUCKS STORE 1123 DAVIS CA", "FOOD_AND_DRINK_COFFEE"),
    tx("2026-10-20", 3_720, "SAFEWAY #0921 DAVIS CA", "FOOD_AND_DRINK_GROCERIES"),
    tx("2026-10-30", -70_980, "CAMPUS DINING PAYROLL PPD", "INCOME_SALARY"),
    tx("2026-11-01", 85_000, "VENMO PAYMENT 1023 RENT ALEX K", "RENT_AND_UTILITIES_RENT"),
    tx("2026-11-04", 2_771, "SAFEWAY #0921 DAVIS CA", "FOOD_AND_DRINK_GROCERIES"),
    tx("2026-11-13", -72_110, "CAMPUS DINING PAYROLL PPD", "INCOME_SALARY"),
    tx("2026-11-14", 4_046, "CHIPOTLE 2201 DAVIS CA", "FOOD_AND_DRINK_FAST_FOOD"),
  ],
  accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 64_218 }],
  liabilities: [],
  told: { home_state: "CA" },
};

const incomeNear = (topic: string) => {
  const s = runDetectors({ profile: buildProfile(data), data }, [
    ...STUDENT_CREDIT_DETECTORS,
    ...SAVERS_CREDIT_DETECTORS,
  ]).find((x) => x.topic === topic);
  return s?.why.match(/income near (\$[\d,]+\.\d{2})/)?.[1];
};

describe("income near, on two tax cards", () => {
  it("is one figure on the Saver's Credit and California's renter's credit", () => {
    const savers = incomeNear("savers_credit");
    expect(savers).toMatch(/^\$\d/);
    expect(incomeNear("ca_renters_credit")).toBe(savers);
  });
});
