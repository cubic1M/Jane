import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { STUDENT_CREDIT_DETECTORS } from "./student-credits";
import { runDetectors } from "./index";

// Manager, 11-20 (#2190): a lender's year to date is so many payments' interest. A loan paid monthly
// on the 8th has made 11 payments by Nov 8 and makes 12 in the year: $860.07 × 12 / 11 = $938.26.
// Paced by day 312 of 365 it read $1,009.40; by the read day (Nov 20), $971.91.

const tx = (date: string, amountCents: number, description: string, pfc: string | null = null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
const payroll = (from: string, to: string, cents: number) => {
  const out = [];
  for (
    let d = Date.parse(`${from}T00:00:00Z`);
    d <= Date.parse(`${to}T00:00:00Z`);
    d += 14 * 86_400_000
  )
    out.push(
      tx(
        new Date(d).toISOString().slice(0, 10),
        -cents,
        "TARGET CORP PAYROLL PPD",
        "INCOME_SALARY",
      ),
    );
  return out;
};
const nelnet = (dates: readonly string[]) =>
  dates.map((d) =>
    tx(d, 21_740, "NELNET STUDENT LN PAYMENT", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
  );

const person = ({
  today,
  pay,
  payments,
  ytd = 86_007,
  lastPayment = "2026-11-08",
  readOn = "2026-11-20",
}: {
  today: string;
  pay: ReturnType<typeof payroll>;
  payments: readonly string[];
  ytd?: number;
  lastPayment?: string | null;
  readOn?: string;
}): ProfileInput => ({
  today,
  transactions: [...pay, ...nelnet(payments)],
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
      ytdInterestPaidCents: ytd,
      ytdInterestReadOn: readOn,
      lastPaymentDate: lastPayment,
    },
  ],
  told: { home_state: "CA", claimed_as_dependent: "no" },
});

const card = (input: ProfileInput) =>
  runDetectors({ profile: buildProfile(input), data: input }, STUDENT_CREDIT_DETECTORS).find(
    (x) => x.topic === "student_loan_interest",
  )!;

// Debug 2's sandbox loan: data from Jul 24, so the Aug–Nov payments seen aren't all of them.
const sandbox = (today: string) =>
  person({
    today,
    pay: payroll("2026-07-24", "2026-11-13", 86_120),
    payments: ["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"],
  });

describe("a lender's interest so far, paced by payments", () => {
  it("is 12 payments' worth from 11 by Nov 8, to the cent", () => {
    expect(card(sandbox("2026-11-20")).why).toContain(
      "Your lender reports $860.07 of interest paid in 2026 through 11 payments (last Nov 8), about $938.26 for the year",
    );
  });

  it("counts a loan started mid-year by the payments seen: 6 so far, 7 in the year", () => {
    const s = card(
      person({
        today: "2026-11-20",
        pay: payroll("2026-01-02", "2026-11-13", 86_120),
        payments: [
          "2026-06-08",
          "2026-07-08",
          "2026-08-08",
          "2026-09-08",
          "2026-10-08",
          "2026-11-08",
        ],
      }),
    );
    // $860.07 × 7 / 6
    expect(s.why).toContain("through 6 payments (last Nov 8), about $1,003.42 for the year");
  });

  it("shows no card when Jane sees no payments (the estimate counts the month instead)", () => {
    expect(
      card(
        person({
          today: "2026-11-20",
          pay: payroll("2026-07-24", "2026-11-13", 86_120),
          payments: [],
        }),
      ),
    ).toBeUndefined();
    // Paid from an account that isn't linked: no payments here, so no card; the estimate counts
    // the month number (src/planning/lender-interest.test.ts).
  });

  it("in January, one payment's interest is the balance and rate", () => {
    const s = card(
      person({
        today: "2027-01-20",
        pay: payroll("2026-07-24", "2027-01-15", 250_000),
        payments: ["2026-11-05", "2026-12-05", "2027-01-08"],
        ytd: 7_400,
        lastPayment: "2027-01-08",
        readOn: "2027-01-19",
      }),
    );
    expect(s.why).toContain("On $16,053.74 owed at 5.50%, a year's interest is about $882.96");
  });

  it("is the same on 12-01, 12-15 and 12-31 over frozen data", () => {
    const days = ["2026-12-01", "2026-12-15", "2026-12-31"].map((d) => card(sandbox(d)));
    expect(days.map((s) => s.worthCents)).toEqual(Array(3).fill(days[0]!.worthCents));
    for (const s of days) expect(s.why).toContain("about $938.26 for the year");
  });
});
