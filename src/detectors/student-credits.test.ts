import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, rateMonthsOf, type ProfileInput, type Told } from "@/profile/build";
import { federalTaxOf, marginalRateFor, studentYearOf } from "@/planning/student-tax";
import { decidesLine } from "@/lib/questions";
import { QUESTIONS } from "@/config/questions";
import { bestQuestion, missingFacts } from "@/profile/questions";
import { STUDENT_SHAPES, STUDENT_TODAY, inputFromStatements } from "./__fixtures__/student-walk";
import { SAVERS_CREDIT_DETECTORS } from "./savers-credit";
import { STUDENT_CREDIT_DETECTORS, phaseLeft } from "./student-credits";
import { runDetectors, type Suggestion } from "./index";

// Credits a student commonly leaves unclaimed (suggest-taxes, 11-18): each rule applies, doesn't,
// its thresholds' edges, and a thin-data student.

const tx = (date: string, amountCents: number, description: string, pfc: string | null = null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
const DAYS = ["2026-09-18", "2026-10-02", "2026-10-16", "2026-10-30", "2026-11-13"];
type Shape = { pay?: number; tuition?: number[]; loan?: number; rent?: string; told?: Told };
// Two months of a student's checking account, from mid-September.
function student({ pay = 0, tuition = [], loan = 0, rent, told = {} }: Shape): ProfileInput {
  return {
    today: STUDENT_TODAY,
    transactions: [
      ...DAYS.map((d) =>
        tx(d, 6_000, "SAFEWAY #1234 MOUNTAIN VIEW CA", "FOOD_AND_DRINK_GROCERIES"),
      ),
      ...(pay ? DAYS.map((d) => tx(d, -pay, "ACME CORP PAYROLL", "INCOME_SALARY")) : []),
      ...tuition.map((c, i) =>
        tx(
          `2026-10-${10 + i}`,
          c,
          "STANFORD UNIVERSITY TUITION PAYMENT",
          "GENERAL_SERVICES_EDUCATION",
        ),
      ),
      ...(loan
        ? ["2026-09-20", "2026-10-20"].map((d) =>
            tx(d, loan, "NELNET STUDENT LOAN PAYMENT", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
          )
        : []),
      ...(rent
        ? ["2026-10-01", "2026-11-01"].map((d) =>
            tx(d, 145_000, rent, rent.includes("R&DE") ? null : "RENT_AND_UTILITIES_RENT"),
          )
        : []),
    ],
    accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 300_000 }],
    liabilities: [],
    told: { home_state: "CA", ...told },
  };
}
const run = (data: ProfileInput, topic: string) =>
  runDetectors({ profile: buildProfile(data), data }, [
    ...STUDENT_CREDIT_DETECTORS,
    ...SAVERS_CREDIT_DETECTORS,
  ]).find((s) => s.topic === topic) ?? null;
const yearOf = (data: ProfileInput) => {
  const profile = buildProfile(data);
  return studentYearOf(data, profile.facts, rateMonthsOf(profile));
};
const passes = (s: Suggestion) => {
  // Facts, not where they go on a return: the IRS's or FTB's page is linked instead (suggestions
  // wording check, 11-18).
  expect(s.why).not.toMatch(/\bline \d|Schedule \d/);
  expect(s.more?.[0].href).toMatch(/^https:\/\/www\.(irs|ftb\.ca)\.gov\//);
  for (const t of [s.title, s.headline, s.short, s.why]) {
    expect(
      checkGuardrails(
        t,
        dollarFigures(t).map((f) => f.cents),
      ),
      t,
    ).toEqual({ ok: true });
    expect(recommendsAChoice(t), t).toBe(false);
  }
};

describe("the phase-out", () => {
  it("leaves all of a credit to the range's start, none from its end, a straight line between", () => {
    expect(phaseLeft(8_000_000, [8_000_000, 9_000_000])).toBe(1);
    expect(phaseLeft(8_500_000, [8_000_000, 9_000_000])).toBe(0.5);
    expect(phaseLeft(9_000_000, [8_000_000, 9_000_000])).toBe(0);
  });
});

describe("the education credits on tuition paid", () => {
  it("figures the American opportunity credit for a dependent undergraduate: on the parent's return", () => {
    const told = { claimed_as_dependent: "yes", enrollment: "undergrad" };
    // 100% of the first $2,000, 25% of the next $2,000.
    expect(run(student({ tuition: [200_000], told }), "education_credit")!.worthCents).toBe(
      200_000,
    );
    const s = run(student({ tuition: [320_000], told }), "education_credit")!;
    expect(s.worthCents).toBe(230_000);
    expect(s.why).toContain("goes on that person's return");
    expect(run(student({ tuition: [400_000], told }), "education_credit")!.worthCents).toBe(
      250_000,
    );
    expect(run(student({ tuition: [600_000], told }), "education_credit")!.worthCents).toBe(
      250_000,
    );
    passes(s);
  });

  it("gives a graduate student the lifetime learning credit, only as far as their tax goes", () => {
    const data = student({
      pay: 150_000,
      tuition: [320_000],
      told: { claimed_as_dependent: "no", enrollment: "grad" },
    });
    const s = run(data, "education_credit")!;
    const y = yearOf(data);
    expect(s.worthCents).toBe(
      Math.min(64_000, federalTaxOf(y.agiCents, "single", false, y.earnedCents)),
    );
    expect(s.why).toContain("lifetime learning credit is 20% of up to $10,000");
    passes(s);
  });

  it("pays the refundable 40% only to someone known to be 25 or older", () => {
    const told = { claimed_as_dependent: "no", enrollment: "undergrad" };
    // No pay: no tax to lower.
    expect(run(student({ tuition: [320_000], told }), "education_credit")).toBeNull();
    const older = run(
      student({ tuition: [320_000], told: { ...told, age_25_plus: "yes" } }),
      "education_credit",
    )!;
    expect(older.worthCents).toBe(92_000);
    expect(older.why).toContain("40% of it is paid even with no tax owed");
  });

  it("says nothing without tuition, for a separate return, a nonresident, or high income", () => {
    const told = { claimed_as_dependent: "yes", enrollment: "undergrad" };
    expect(run(student({ told }), "education_credit")).toBeNull();
    expect(run(student({ tuition: [19_999], told }), "education_credit")).toBeNull();
    expect(run(student({ tuition: [20_000], told }), "education_credit")).not.toBeNull();
    expect(
      run(
        student({ tuition: [320_000], told: { ...told, filing_status: "married_separate" } }),
        "education_credit",
      ),
    ).toBeNull();
    expect(
      run(
        student({ tuition: [320_000], told: { ...told, tax_residency: "student_visa" } }),
        "education_credit",
      ),
    ).toBeNull();
    // About $93,000 of pay a year: past the $90,000 end of the range.
    expect(run(student({ pay: 550_000, tuition: [320_000], told }), "education_credit")).toBeNull();
  });

  it("is unsure until it knows the enrollment and who claims the student", () => {
    const s = run(student({ pay: 150_000, tuition: [320_000], told: {} }), "education_credit")!;
    expect(s.confidence.percent).toBeLessThanOrEqual(55);
    expect(s.why).toContain("If you're an undergraduate in your first four years");
  });
});

describe("student loan interest", () => {
  it("is worth the interest at their top rate, at most the whole payment, up to $2,500", () => {
    const data = student({ pay: 150_000, loan: 21_500, told: { claimed_as_dependent: "no" } });
    const s = run(data, "student_loan_interest")!;
    const y = yearOf(data);
    const paidYear = Math.round((43_000 * 12) / rateMonthsOf(buildProfile(data)));
    expect(s.worthCents).toBe(
      Math.round(
        Math.min(250_000, paidYear) * marginalRateFor(y.agiCents, "single", false, y.earnedCents),
      ),
    );
    expect(s.confidence.percent).toBeLessThanOrEqual(45);
    passes(s);
  });

  it("says nothing with no tax to lower, for a dependent, a separate return, or past $100,000", () => {
    expect(run(student({ loan: 21_500 }), "student_loan_interest")).toBeNull();
    expect(
      run(
        student({ pay: 150_000, loan: 21_500, told: { claimed_as_dependent: "yes" } }),
        "student_loan_interest",
      ),
    ).toBeNull();
    expect(
      run(
        student({ pay: 150_000, loan: 21_500, told: { filing_status: "married_separate" } }),
        "student_loan_interest",
      ),
    ).toBeNull();
    expect(run(student({ pay: 600_000, loan: 21_500 }), "student_loan_interest")).toBeNull();
    expect(run(student({ pay: 150_000 }), "student_loan_interest")).toBeNull();
  });
});

describe("the earned income credit without children", () => {
  it("figures it from pay for someone 25 to 64", () => {
    const data = student({ pay: 40_000, told: { age_25_plus: "yes", claimed_as_dependent: "no" } });
    const s = run(data, "earned_income_credit")!;
    expect(s.worthCents).toBeGreaterThan(0);
    expect(s.worthCents).toBeLessThanOrEqual(66_400);
    expect(s.why).toContain("ages 25 to 64");
    passes(s);
  });

  it("says nothing before it knows the age, under 25, for a dependent, a parent, a nonresident, or over the limit", () => {
    const told = { age_25_plus: "yes", claimed_as_dependent: "no" };
    expect(run(student({ pay: 40_000 }), "earned_income_credit")).toBeNull();
    expect(
      run(student({ pay: 40_000, told: { ...told, age_25_plus: "no" } }), "earned_income_credit"),
    ).toBeNull();
    expect(
      run(
        student({ pay: 40_000, told: { ...told, claimed_as_dependent: "yes" } }),
        "earned_income_credit",
      ),
    ).toBeNull();
    expect(
      run(student({ pay: 40_000, told: { ...told, has_children: true } }), "earned_income_credit"),
    ).toBeNull();
    expect(
      run(
        student({ pay: 40_000, told: { ...told, tax_residency: "student_visa" } }),
        "earned_income_credit",
      ),
    ).toBeNull();
    expect(run(student({ told }), "earned_income_credit")).toBeNull();
    // About $27,000 a year of pay: past $19,540.
    expect(run(student({ pay: 160_000, told }), "earned_income_credit")).toBeNull();
  });
});

describe("California's renter's credit", () => {
  it("is $60 for a single renter off campus in California, $120 joint", () => {
    const s = run(
      student({ pay: 40_000, rent: "OAK CREEK APARTMENTS RENT" }),
      "ca_renters_credit",
    )!;
    expect(s.worthCents).toBe(6_000);
    expect(s.confidence.percent).toBeLessThanOrEqual(55);
    expect(s.why).toContain("isn't exempt from property tax");
    passes(s);
    expect(
      run(
        student({
          pay: 40_000,
          rent: "OAK CREEK APARTMENTS RENT",
          told: { filing_status: "married_joint" },
        }),
        "ca_renters_credit",
      )!.worthCents,
    ).toBe(12_000);
  });

  it("says nothing outside California, for campus housing, or over the income limit", () => {
    expect(
      run(
        student({ pay: 40_000, rent: "OAK CREEK APARTMENTS RENT", told: { home_state: "other" } }),
        "ca_renters_credit",
      ),
    ).toBeNull();
    expect(
      run(student({ pay: 40_000, rent: "STANFORD R&DE HOUSING PAYMENT" }), "ca_renters_credit"),
    ).toBeNull();
    // About $60,000 a year: past $53,994.
    expect(
      run(student({ pay: 350_000, rent: "OAK CREEK APARTMENTS RENT" }), "ca_renters_credit"),
    ).toBeNull();
  });
});

describe("the Saver's Credit and a student", () => {
  it("isn't offered to someone who said they're in school at least half time", () => {
    const base = { monthly_income: 200_000, filing_status: "single" } as const;
    for (const enrollment of ["undergrad", "grad"]) {
      expect(
        run(student({ pay: 100_000, told: { ...base, enrollment } }), "savers_credit"),
      ).toBeNull();
      expect(
        run(student({ pay: 100_000, told: { ...base, enrollment } }), "savers_match"),
      ).toBeNull();
    }
    expect(
      run(
        student({ pay: 100_000, told: { ...base, enrollment: "not_enrolled" } }),
        "savers_credit",
      ),
    ).not.toBeNull();
  });
});

describe("the questions credits need", () => {
  it("asks a gig student whether they're in school first: it decides two credits", async () => {
    const data = await inputFromStatements(STUDENT_SHAPES["gig-two-months"](), STUDENT_TODAY);
    const best = bestQuestion(buildProfile(data), data, new Set())!;
    expect(best.spec.fact).toBe("enrollment");
    expect(decidesLine(best.spec, best.decidesCount)).toBe("It decides 2 credits for you.");
    const facts = missingFacts(buildProfile(data), data).map((c) => c.spec.fact);
    expect(facts).toContain("age_25_plus");
  });

  it("asks a one-month undergraduate who claims them: it decides the education credit", async () => {
    const data = await inputFromStatements(STUDENT_SHAPES["undergrad-one-month"](), STUDENT_TODAY);
    const best = bestQuestion(buildProfile(data), data, new Set())!;
    expect(best.spec.fact).toBe("claimed_as_dependent");
    expect(QUESTIONS.find((q) => q.fact === "home_state")!.choices.map((c) => c.value)).toEqual([
      "CA",
      "other",
      "unsure",
    ]);
  });
});
