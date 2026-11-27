import { describe, expect, it } from "vitest";
import { FILING_SINGLE_ASSUMPTION } from "@/planning/tax-profile";
import { buildProfile, type ProfileInput, type Told } from "@/profile/build";
import { STUDENT_TODAY } from "./__fixtures__/student-walk";
import { STUDENT_CREDIT_DETECTORS } from "./student-credits";
import { runDetectors } from "./index";

// T8b: the student cards price a person who has not said how they file with the same one guess as the
// estimate and the Saver's Credit: single, with the assumption beside children (head of household is
// never guessed, IRS Pub. 501), married filing jointly only on a sign of a partner. They used to take
// any family as filing jointly.

const tx = (date: string, amountCents: number, description: string, pfc: string | null = null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});

const data = (told: Told): ProfileInput => ({
  today: STUDENT_TODAY,
  transactions: [
    ...["2026-09-18", "2026-10-02", "2026-10-16", "2026-10-30", "2026-11-13"].map((d) =>
      tx(d, -250_000, "ACME CORP PAYROLL", "INCOME_SALARY"),
    ),
    ...["2026-09-20", "2026-10-20"].map((d) =>
      tx(d, 40_000, "NELNET STUDENT LOAN PAYMENT", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
    ),
  ],
  accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 300_000 }],
  liabilities: [],
  told: { home_state: "CA", tax_residency: "citizen", has_children: true, ...told },
});

const loanInterest = (told: Told) => {
  const d = data(told);
  return runDetectors({ profile: buildProfile(d), data: d }, STUDENT_CREDIT_DETECTORS).find(
    (s) => s.topic === "student_loan_interest",
  );
};

describe("the student cards' one filing guess", () => {
  it("prices a parent with no sign of a partner as single, and says so", () => {
    const card = loanInterest({ household: "family" });
    expect(card?.why).toContain(FILING_SINGLE_ASSUMPTION);
  });
  it("prices a told partner as joint, with nothing assumed", () => {
    const card = loanInterest({ household: "family", has_partner: true });
    expect(card).toBeDefined();
    expect(card?.why).not.toContain(FILING_SINGLE_ASSUMPTION);
  });
  it("assumes nothing once they say how they file", () => {
    const card = loanInterest({ household: "family", filing_status: "head_of_household" });
    expect(card).toBeDefined();
    expect(card?.why).not.toContain(FILING_SINGLE_ASSUMPTION);
  });
});
