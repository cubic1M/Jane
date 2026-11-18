import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { STUDENT_CREDIT_DETECTORS } from "./student-credits";
import { runDetectors } from "./index";

// Debug 2, sixth desktop sweep (11-18, Plaid sandbox checking + student and car loans, Jul 24 –
// Nov 14): "Check the student loan interest" said "You paid $869.60 to Nelnet Student Ln in 4
// months, about $2,691.71 a year at that pace", beside "You pay about $217.40 a month on student
// loans" ($2,608.80 a year) in the same dock. Four $217.40 payments over 3.9 months of data read
// as more than 12 a year.

const tx = (date: string, amountCents: number, description: string, pfc: string | null = null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
const pay = ["2026-07-24", "2026-08-07", "2026-08-21", "2026-09-04", "2026-09-18", "2026-10-02"];
const data: ProfileInput = {
  today: "2026-11-18",
  transactions: [
    ...pay.map((d) => tx(d, -86_120, "TARGET CORP PAYROLL PPD", "INCOME_SALARY")),
    ...["2026-10-16", "2026-10-30", "2026-11-13"].map((d) =>
      tx(d, -86_120, "TARGET CORP PAYROLL PPD", "INCOME_SALARY"),
    ),
    ...["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"].map((d) =>
      tx(d, 21_740, "NELNET STUDENT LN PAYMENT", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
    ),
    tx("2026-11-14", 7_000, "T-MOBILE", "RENT_AND_UTILITIES_TELEPHONE"),
  ],
  accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 164_025 }],
  liabilities: [],
  told: { home_state: "CA", claimed_as_dependent: "no" },
};

describe("a student loan's year of payments", () => {
  it("is the monthly payment twelve times, as the other student-loan card says it", () => {
    const s = runDetectors({ profile: buildProfile(data), data }, STUDENT_CREDIT_DETECTORS).find(
      (x) => x.topic === "student_loan_interest",
    )!;
    expect(s.why).toContain("about $2,608.80 a year at $217.40 a month");
  });
});
