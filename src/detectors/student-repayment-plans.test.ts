import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { compareStudentPlans } from "@/planning/student-loans";
import { formatCents } from "@/lib/money";
import { runDetectors } from "./index";

// Debug 2, desktop sweep 7 (11-18, Plaid sandbox + loans: Target pay every two weeks, Nelnet $217.40
// a month on a $16,053.74 Direct loan at 5.50%): Loans' "A better student loan plan, $929/yr" said
// an income-driven plan "would ask roughly $139.98" (7% of take-home pay), and the page it opened,
// /loans/student, compared RAP at $41.36 and IBR at $7.30. The card asks the plans' own rules, at
// the income the page uses.

const tx = (date: string, amountCents: number, description: string, pfc: string): ProfileTx => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "chk",
});
const months = ["08", "09", "10", "11"];
const data: ProfileInput = {
  today: "2026-11-18",
  accounts: [
    { id: "chk", type: "depository", subtype: "checking", balanceCents: 164_025 },
    { id: "ln", type: "loan", subtype: "student", balanceCents: 1_605_374 },
  ],
  liabilities: [
    { accountId: "ln", kind: "student", aprBps: 550, hasPmi: null, payoffDate: "2033-09-01" },
  ],
  told: {},
  transactions: [
    tx("2026-07-24", -93_850, "TARGET CORP PAYROLL PPD", "INCOME_WAGES"),
    ...months.flatMap((m) => [
      tx(`2026-${m}-05`, 21_740, "NELNET STUDENT LN PAYMENT", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
      tx(`2026-${m}-07`, -93_850, "TARGET CORP PAYROLL PPD", "INCOME_WAGES"),
    ]),
    tx("2026-11-14", 7_000, "T-MOBILE", "RENT_AND_UTILITIES_TELEPHONE"),
  ],
};

describe("the student loan plan card", () => {
  it("says what the page's lowest income-driven plan asks, at the page's income", () => {
    const card = runDetectors({ profile: buildProfile(data), data }).find(
      (s) => s.topic === "student_repayment",
    );
    // The page: five paychecks over the 114 days Jul 24 – Nov 14 cover, paced to a year.
    const agi = Math.round((5 * 93_850 * 365) / 114);
    const plans = compareStudentPlans(
      {
        balanceCents: 1_605_374,
        aprBps: 550,
        currentPaymentCents: 21_740,
        agiCents: agi,
        familySize: 1,
        dependants: 0,
        borrower: "new",
        publicService: false,
        paymentsCounted: 0,
      },
      { advice: false },
    ).results;
    const lowest = Math.min(
      ...plans.filter((r) => r.plan === "ibr" || r.plan === "rap").map((r) => r.monthlyNowCents),
    );
    expect(card?.why.match(/would ask (?:roughly|about) (\$[\d,]+\.\d{2})/)?.[1]).toBe(
      formatCents(lowest),
    );
    expect(card?.worthCents).toBe((21_740 - lowest) * 12);
  });
});
