import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { STUDENT_CREDIT_DETECTORS } from "./student-credits";
import { runDetectors } from "./index";

// Debug 2, tenth desktop sweep (11-20, Plaid sandbox checking + student and car loans): Taxes said
// "On $16,053.74 owed at 5.50%, a year's interest is about $882.96" on the student loan interest
// card, and "Student loan interest, $971.91" in the audit records a few rows down: the lender
// reported $860.07 paid since January 1, which the tax estimate paces to the year. The card reads
// the lender's figure the same way.

const tx = (date: string, amountCents: number, description: string, pfc: string | null = null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
const pay = ["2026-07-24", "2026-08-07", "2026-08-21", "2026-09-04", "2026-09-18", "2026-10-02"];
const data = (ytdInterestPaidCents: number | null): ProfileInput => ({
  today: "2026-11-20",
  transactions: [
    ...[...pay, "2026-10-16", "2026-10-30", "2026-11-13"].map((d) =>
      tx(d, -86_120, "TARGET CORP PAYROLL PPD", "INCOME_SALARY"),
    ),
    ...["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"].map((d) =>
      tx(d, 21_740, "NELNET STUDENT LN PAYMENT", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
    ),
  ],
  accounts: [
    { id: "checking", type: "depository", subtype: "checking", balanceCents: 164_025 },
    { id: "student", type: "loan", subtype: "student", balanceCents: 1_605_374 },
  ],
  liabilities: [
    {
      accountId: "student",
      kind: "student",
      aprBps: 550,
      hasPmi: null,
      payoffDate: "2033-09-01",
      ytdInterestPaidCents,
    },
  ],
  told: { home_state: "CA", claimed_as_dependent: "no" },
});

const card = (input: ProfileInput) =>
  runDetectors({ profile: buildProfile(input), data: input }, STUDENT_CREDIT_DETECTORS).find(
    (x) => x.topic === "student_loan_interest",
  )!;

describe("a student loan's year of interest", () => {
  it("is the lender's interest so far, paced to the year as the tax estimate does", () => {
    const s = card(data(86_007));
    expect(s.why).toContain(
      "Your lender reports $860.07 of interest paid so far this year, about $971.91 for the year",
    );
    expect(s.why).not.toContain("$882.96");
  });

  it("is worked out from the balance and rate when the lender reports none", () => {
    expect(card(data(null)).why).toContain(
      "On $16,053.74 owed at 5.50%, a year's interest is about $882.96",
    );
  });
});
