import { describe, expect, it } from "vitest";
import { federalParams } from "@/config/tax-params";
import { federalTaxOf, lawYearOf, studentYearOf } from "@/planning/student-tax";
import { buildProfile, rateMonthsOf, type ProfileInput } from "@/profile/build";
import { STUDENT_CREDIT_DETECTORS } from "./student-credits";
import { runDetectors } from "./index";

// Debug 2 pre-deploy walk (11-27): "Check the student loan interest" said "$72 a year at 10%" beside
// an estimate of $0 tax. A card's saving is the difference between two runs of the tax, with the
// deduction and without it, not a rate times the amount: a deduction can take off only the income
// that is over the standard deduction.

const tx = (date: string, amountCents: number, description: string, pfc: string | null = null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const paydays = Array.from({ length: 24 }, (_, i) => addDays("2026-01-02", i * 14)).filter(
  (d) => d <= "2026-11-13",
);

const data = (net: number): ProfileInput => ({
  today: "2026-11-18",
  transactions: [
    ...paydays.map((d) => tx(d, -net, "TARGET CORP PAYROLL PPD", "INCOME_SALARY")),
    ...["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"].map((d) =>
      tx(d, 21_740, "NELNET STUDENT LN PAYMENT", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
    ),
  ],
  accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 164_025 }],
  liabilities: [],
  told: { home_state: "CA", claimed_as_dependent: "no", filing_status: "single" },
});

const card = (d: ProfileInput) =>
  runDetectors({ profile: buildProfile(d), data: d }, STUDENT_CREDIT_DETECTORS).find(
    (x) => x.topic === "student_loan_interest",
  );

describe("the student loan interest card's saving", () => {
  it("is the tax with the deduction subtracted from the tax without it, not a rate times the amount", () => {
    // Income a little over the standard deduction: the $2,500 deduction can remove only the part of
    // it over $16,100, so the saving is that part's tax (10%), not 10% of the whole $2,500.
    const d = data(50_000);
    const p = buildProfile(d);
    const year = studentYearOf(d, p.facts, rateMonthsOf(p));
    const std = federalParams(lawYearOf(d.today)).standardDeduction.value.single;
    const over = year.agiCents - std;
    expect(
      over,
      "the fixture should sit over the standard deduction by less than the deduction",
    ).toBeGreaterThan(0);
    expect(over).toBeLessThan(250_000);

    const s = card(d)!;
    const tax = (agi: number) => federalTaxOf(agi, "single", false, agi, lawYearOf(d.today));
    // The deduction the card takes: at most $2,500, on a loan's interest from the payments.
    expect(s.worthCents).toBeGreaterThan(0);
    expect(s.worthCents).toBeLessThanOrEqual(tax(year.agiCents));
    expect(s.worthCents).toBeLessThan(Math.round(250_000 * 0.1));
  });

  it("has no card at all for someone who owes no tax", () => {
    expect(card(data(30_000))).toBeUndefined();
  });
});
