import { describe, expect, it } from "vitest";
import { buildProfile, rateMonthsOf, type ProfileInput } from "@/profile/build";
import { federalTaxOf, studentYearOf } from "@/planning/student-tax";
import { selfEmploymentTax } from "@/planning/tax-estimate";
import { formatCents } from "@/lib/money";
import { SIDE_INCOME_DETECTORS } from "./side-income";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c, det-03 findings 5, 6 and 10.
const tx = (date: string, amountCents: number, description: string, pfc: string) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
const monthly = (year: number, months: number[], day = 20) =>
  months.map((m) => `${year}-${String(m).padStart(2, "0")}-${day}`);
const person = (today: string, rows: ReturnType<typeof tx>[]): ProfileInput => ({
  today,
  transactions: rows,
  accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 100_000 }],
  liabilities: [],
  told: {},
});
const run = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, SIDE_INCOME_DETECTORS)[0] ?? null;

describe("side income paced over this year's months", () => {
  it("does not spread six months of this year's payouts over twelve months of history", () => {
    // History from July of last year to June 30; $1,000 payouts only in January to June.
    const rows = [
      ...monthly(2025, [7, 8, 9, 10, 11, 12], 5).map((d) =>
        tx(d, 6_000, "SAFEWAY MOUNTAIN VIEW CA", "FOOD_AND_DRINK_GROCERIES"),
      ),
      ...monthly(2026, [1, 2, 3, 4, 5, 6], 5).map((d) =>
        tx(d, 6_000, "SAFEWAY MOUNTAIN VIEW CA", "FOOD_AND_DRINK_GROCERIES"),
      ),
      ...monthly(2026, [1, 2, 3, 4, 5, 6]).map((d) =>
        tx(d, -100_000, "ACME CORP PAYROLL", "INCOME_SALARY"),
      ),
      ...monthly(2026, [1, 2, 3, 4, 5, 6]).map((d) =>
        tx(d, -100_000, "STRIPE PAYOUT", "INCOME_GIG_ECONOMY"),
      ),
    ];
    const s = run(person("2026-06-30", rows))!;
    expect(s).not.toBeNull();
    const pace = Number(
      /about \$([\d,]+)\.\d\d a year at that pace/.exec(s.why)![1].replace(/,/g, ""),
    );
    // By hand: $6,000 in about six months is about $12,000 a year, not the $6,000 of twelve months.
    expect(pace).toBeGreaterThan(11_500);
    expect(pace).toBeLessThan(13_000);
  });
});

describe("the income tax on side income", () => {
  it("is the tax with the side money less the tax without it, not the top rate on all of it", () => {
    const rows = [
      ...monthly(2026, [8, 9, 10, 11], 5).map((d) =>
        tx(d, 6_000, "SAFEWAY MOUNTAIN VIEW CA", "FOOD_AND_DRINK_GROCERIES"),
      ),
      ...monthly(2026, [8, 9, 10, 11]).map((d) =>
        tx(d, -150_000, "ACME CORP PAYROLL", "INCOME_SALARY"),
      ),
      ...monthly(2026, [8, 9, 10, 11]).map((d) =>
        tx(d, -250_000, "STRIPE PAYOUT", "INCOME_GIG_ECONOMY"),
      ),
    ];
    const data = person("2026-11-25", rows);
    const profile = buildProfile(data);
    const s = run(data)!;
    const wages = studentYearOf(data, profile.facts, rateMonthsOf(profile)).wagesCents;
    const pace = Math.round((1_000_000 * 12) / rateMonthsOf(profile));
    const se = selfEmploymentTax(pace, wages);
    const income =
      federalTaxOf(wages + pace - Math.round(se / 2), "single", false, wages + pace) -
      federalTaxOf(wages, "single", false, wages);
    expect(s.why).toContain(`${formatCents(income)} of income tax`);
    // Part of the side money still falls inside the standard deduction, so this is under the top rate
    // times all of it.
    expect(income).toBeLessThan(Math.round(pace * 0.24));
  });
});

describe("the estimated-payment rule on a side-income card", () => {
  it("does not say none is required from the side income alone", () => {
    const rows = [
      ...monthly(2026, [8, 9, 10, 11], 5).map((d) =>
        tx(d, 6_000, "SAFEWAY MOUNTAIN VIEW CA", "FOOD_AND_DRINK_GROCERIES"),
      ),
      ...monthly(2026, [8, 9, 10, 11]).map((d) =>
        tx(d, -150_000, "ACME CORP PAYROLL", "INCOME_SALARY"),
      ),
      ...monthly(2026, [8, 9, 10, 11]).map((d) =>
        tx(d, -12_000, "STRIPE PAYOUT", "INCOME_GIG_ECONOMY"),
      ),
    ];
    const s = run(person("2026-11-25", rows));
    expect(s).not.toBeNull();
    expect(s!.why).not.toMatch(/doesn't require estimated payments/);
    expect(s!.why).toContain("depends on what your whole");
  });
});
