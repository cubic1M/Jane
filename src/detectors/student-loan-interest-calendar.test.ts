import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { STUDENT_CREDIT_DETECTORS } from "./student-credits";
import { runDetectors } from "./index";

// Gate C's calendar sweep (11-20, the demo person, frozen data, 12-01 to 12-31): the student loan
// interest card's worth fell about $0.58 a day ("about $882.91 for the year", then "$880.26"):
// #2182 paced the lender's year to date by today, though the figure is as of the day it was read.
// It's paced by that day: the same over any days with no new reading.

const tx = (date: string, amountCents: number, description: string, pfc: string | null = null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
const pay = ["2026-07-24", "2026-08-07", "2026-08-21", "2026-09-04", "2026-09-18", "2026-10-02"];
// In January the data runs into the new year, with more pay: one January paycheck of the 2026 pay is
// below tax for 2027, so no card at all.
const january = ["2026-11-27", "2026-12-11", "2026-12-25", "2027-01-08"];
// `back` moves every date back that many years: January 2027 has no IRS figures yet (a card priced
// for a year without them is held back), so the January case runs one year earlier, January 2026.
const yearsBack = (d: string, back: number) => `${Number(d.slice(0, 4)) - back}${d.slice(4)}`;
const data = (
  today: string,
  reading: { cents: number; asOf: string } | null = { cents: 86_007, asOf: "2026-11-20" },
  back = 0,
): ProfileInput => ({
  today: yearsBack(today, back),
  transactions: [
    ...[...pay, "2026-10-16", "2026-10-30", "2026-11-13", ...(today > "2027" ? january : [])].map(
      (d) =>
        tx(
          yearsBack(d, back),
          today > "2027" ? -250_000 : -86_120,
          "TARGET CORP PAYROLL PPD",
          "INCOME_SALARY",
        ),
    ),
    ...[
      "2026-08-05",
      "2026-09-05",
      "2026-10-05",
      "2026-11-05",
      ...(today > "2027" ? ["2026-12-05", "2027-01-05"] : []),
    ].map((d) =>
      tx(
        yearsBack(d, back),
        21_740,
        "NELNET STUDENT LN PAYMENT",
        "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
      ),
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
      ytdInterestPaidCents: reading?.cents ?? null,
      ytdInterestReadOn: reading?.asOf ? yearsBack(reading.asOf, back) : null,
    },
  ],
  told: { home_state: "CA", claimed_as_dependent: "no" },
});

const card = (input: ProfileInput) =>
  runDetectors({ profile: buildProfile(input), data: input }, STUDENT_CREDIT_DETECTORS).find(
    (x) => x.topic === "student_loan_interest",
  )!;

describe("a student loan's year of interest on the calendar", () => {
  it("is the same on 12-01, 12-15 and 12-31 over frozen data", () => {
    const days = ["2026-12-01", "2026-12-15", "2026-12-31"].map((d) => card(data(d)));
    expect(days.map((s) => s.worthCents)).toEqual(Array(3).fill(days[0]!.worthCents));
    for (const s of days) {
      expect(s.why).toContain(
        "Your lender reports $860.07 of interest paid in 2026 by Nov 20, about $971.91 for the year",
      );
    }
  });

  it("paces a reading made today to the year so far", () => {
    expect(card(data("2026-12-15", { cents: 93_100, asOf: "2026-12-15" })).why).toContain(
      "$931.00 of interest paid in 2026 by Dec 15, about $976.48 for the year",
    );
  });

  it("holds the card back in a year with no IRS figures (January 2028)", () => {
    // Every date a year later: 2028 has no parameter file, so nothing is priced with another year's law.
    expect(card(data("2027-01-20", { cents: 1_450, asOf: "2027-01-20" }, -1))).toBeUndefined();
  });

  it("prices January 2027 with 2027's own phase-out ($90,000 to $105,000), not 2026's (T32b)", () => {
    const s = card(data("2027-01-20", { cents: 1_450, asOf: "2027-01-20" }));
    expect(s).toBeDefined();
    expect(s.why).toContain("it shrinks from $90,000 to $105,000 of income");
    expect(s.why).not.toContain("$85,000");
  });

  it("in January, works a year out from the balance and rate, not weeks of interest", () => {
    // A fresh January reading is a few weeks of interest; December's is last year's.
    for (const reading of [
      { cents: 1_450, asOf: "2027-01-20" },
      { cents: 93_100, asOf: "2026-12-15" },
    ]) {
      const s = card(data("2027-01-20", reading, 1));
      expect(s.why).toContain("On $16,053.74 owed at 5.50%, a year's interest is about $882.96");
      expect(s.why).not.toContain("Your lender reports");
    }
  });
});
