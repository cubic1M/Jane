import { describe, expect, it } from "vitest";
import { buildProfile, rateMonthsOf, type ProfileInput } from "@/profile/build";
import { federalTaxOf, studentYearOf } from "@/planning/student-tax";
import { selfEmploymentTax } from "@/planning/tax-estimate";
import { formatCents } from "@/lib/money";
import { SIDE_INCOME_DETECTORS } from "./side-income";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c (#2270): a taxable fellowship uses the standard deduction before the side
// income does, so the side income is taxed on top of it.
const tx = (date: string, amountCents: number, description: string, pfc: string) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
const days = ["2026-08-20", "2026-09-20", "2026-10-20", "2026-11-20"];
const data: ProfileInput = {
  today: "2026-11-25",
  transactions: [
    ...days.map((d) => tx(d, -80_000, "ACME CORP PAYROLL", "INCOME_SALARY")),
    ...days.map((d) =>
      tx(d, -250_000, "STANFORD UNIVERSITY FELLOWSHIP STIPEND", "INCOME_OTHER_INCOME"),
    ),
    ...days.map((d) => tx(d, -100_000, "STRIPE PAYOUT", "INCOME_GIG_ECONOMY")),
  ],
  accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 100_000 }],
  liabilities: [],
  told: {},
};

describe("side income beside a fellowship", () => {
  it("taxes the side income on top of the fellowship, not into the deduction it used", () => {
    const profile = buildProfile(data);
    const s = runDetectors({ profile, data }, SIDE_INCOME_DETECTORS)[0]!;
    const year = studentYearOf(data, profile.facts, rateMonthsOf(profile));
    expect(year.stipendCents).toBeGreaterThan(0);
    const pace = Math.round((400_000 * 12) / rateMonthsOf(profile));
    const se = selfEmploymentTax(pace, year.wagesCents);
    const base = year.wagesCents + year.stipendCents;
    const income =
      federalTaxOf(base + pace - Math.round(se / 2), "single", false, year.wagesCents + pace) -
      federalTaxOf(base, "single", false, year.wagesCents);
    const wagesOnly =
      federalTaxOf(
        year.wagesCents + pace - Math.round(se / 2),
        "single",
        false,
        year.wagesCents + pace,
      ) - federalTaxOf(year.wagesCents, "single", false, year.wagesCents);
    expect(income).toBeGreaterThan(wagesOnly);
    expect(s.why).toContain(`${formatCents(income)} of income tax`);
  });
});
