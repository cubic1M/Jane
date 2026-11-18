import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, rateMonthsOf, type ProfileInput, type Told } from "@/profile/build";
import { federalTaxOf } from "@/planning/student-tax";
import { runDetectors, type Suggestion } from "./index";
import { STUDENT_TAX_DETECTORS, datesLine, penaltyRule } from "./student-taxes";
import { STUDENT_SHAPES, STUDENT_TODAY, inputFromStatements } from "./__fixtures__/student-walk";

// A fellowship with nothing withheld, and what a student on an F or J visa files (suggest-taxes,
// 11-18). Each rule: applies, doesn't, the edge of each threshold, and a thin-data student.

const tx = (date: string, amountCents: number, description: string, pfc: string | null = null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
// Two months of a student's checking account: groceries from mid-September, and the deposits given.
function student(
  deposits: ReturnType<typeof tx>[],
  told: Told = {},
  today = STUDENT_TODAY,
): ProfileInput {
  const groceries = ["2026-09-18", "2026-10-02", "2026-10-16", "2026-10-30", "2026-11-13"].map(
    (d) => tx(d, 6_000, "SAFEWAY #1234 MOUNTAIN VIEW CA", "FOOD_AND_DRINK_GROCERIES"),
  );
  return {
    today,
    transactions: [...groceries, ...deposits],
    accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 300_000 }],
    liabilities: [],
    told,
  };
}
const stipend = (date: string, cents = 475_000) =>
  tx(date, -cents, "STANFORD UNIV FELLOWSHIP STIPEND PPD ID: 1946001");
const refund = (date: string, cents = 475_000) =>
  tx(date, -cents, "STANFORD UNIV STUDENT ACCT REFUND PPD ID: 1946001");

const run = (data: ProfileInput, topic = "stipend_tax") =>
  runDetectors({ profile: buildProfile(data), data }, STUDENT_TAX_DETECTORS).find(
    (s) => s.topic === topic,
  ) ?? null;

const words = (s: Suggestion) => `${s.title} ${s.headline} ${s.short} ${s.why}`;
const passesGuardrails = (s: Suggestion) => {
  const text = words(s);
  expect(
    checkGuardrails(
      text,
      dollarFigures(text).map((f) => f.cents),
    ),
    text,
  ).toEqual({ ok: true });
  expect(recommendsAChoice(text), text).toBe(false);
};

describe("tax on a fellowship", () => {
  it("works out the year's federal tax at the stipends' pace, with the date and the rule", () => {
    const data = student([stipend("2026-10-01"), stipend("2026-11-02")], { home_state: "CA" });
    const s = run(data)!;
    const yearly = Math.round((950_000 * 12) / rateMonthsOf(buildProfile(data)));
    expect(s.worthCents).toBe(federalTaxOf(yearly, "single", false));
    expect(s.worthKind).toBe("risk");
    expect(s.why).toContain("Stanford doesn't withhold tax from fellowship stipends");
    // A fact, not a form line (suggestions wording check, 11-18), with the IRS's page linked.
    expect(s.why).toContain("is income for federal tax (IRS Pub. 970)");
    expect(s.why).not.toMatch(/\bline \d/);
    expect(s.more?.[0].href).toBe("https://www.irs.gov/publications/p970");
    expect(s.why).toContain("January 15, 2027");
    expect(s.why).toContain("February 1, 2027");
    expect(s.why).toContain("California's next date is January 15, 2027, for 30%");
    expect(s.why).toContain("smaller of 90% of 2026's tax or 100% of 2025's");
    expect(s.why).toContain("they say they're a stipend or fellowship");
    expect(s.confidence.percent).toBeGreaterThanOrEqual(50);
    passesGuardrails(s);
  });

  it("is unsure of a bare student-account refund until the person says it's a fellowship", () => {
    const guessed = run(student([refund("2026-10-01"), refund("2026-11-02")]))!;
    expect(guessed.confidence.percent).toBeLessThan(50);
    expect(guessed.why).toContain("which, only you know");
    const told = run(
      student([refund("2026-10-01"), refund("2026-11-02")], { school_deposit: "fellowship" }),
    )!;
    expect(told.confidence.percent).toBeGreaterThan(guessed.confidence.percent);
    expect(told.why).toContain("you told me these are a fellowship");
    passesGuardrails(guessed);
  });

  it("says nothing when the money is pay, aid, a nonresident's, or not there", () => {
    const deposits = [stipend("2026-10-01"), stipend("2026-11-02")];
    expect(run(student(deposits, { school_deposit: "wage" }))).toBeNull();
    expect(run(student(deposits, { school_deposit: "aid_refund" }))).toBeNull();
    expect(run(student(deposits, { tax_residency: "student_visa" }))).toBeNull();
    expect(run(student([]))).toBeNull();
    // "Not sure" is an answer, and changes nothing.
    expect(run(student(deposits, { school_deposit: "unsure" }))).not.toBeNull();
  });

  it("says nothing when the year's tax is under $100, and fires from $100", () => {
    // Two months of data: $2,850 is about $17,065 a year at that pace, $96 of tax over $16,100.
    expect(run(student([stipend("2026-11-02", 285_000)]))).toBeNull();
    // $2,900 is about $17,365 a year: $126.
    expect(run(student([stipend("2026-11-02", 290_000)]))).not.toBeNull();
  });

  it("leaves a dependent's tax on a fellowship the same: it counts as earned for the deduction", () => {
    const deposits = [stipend("2026-10-01", 150_000), stipend("2026-11-02", 150_000)];
    const own = run(student(deposits, { claimed_as_dependent: "no" }))!;
    const dependent = run(student(deposits, { claimed_as_dependent: "yes" }))!;
    expect(dependent.worthCents).toBe(own.worthCents);
  });

  it("names the no-2025-tax exception when they said they owed none", () => {
    const s = run(
      student([stipend("2026-10-01"), stipend("2026-11-02")], { owed_tax_last_year: "no" }),
    )!;
    expect(s.why).toContain("doesn't require 2026 estimated payments");
    expect(s.why).not.toContain("underpayment penalty");
    passesGuardrails(s);
  });

  it("finds a thin-data fellow from one month of an uploaded statement", async () => {
    const data = await inputFromStatements(STUDENT_SHAPES["fellowship-one-month"](), STUDENT_TODAY);
    const s = run(data)!;
    expect(s.why).toContain("in 1 month");
    expect(s.why).not.toMatch(/\d\.\d{3}/);
    expect(s.why).toContain("Stanford's student account");
    passesGuardrails(s);
  });
});

describe("the penalty rule and the dates", () => {
  it("draws the $1,000 line at $1,000", () => {
    expect(penaltyRule(null, false, 99_999)).toContain("doesn't require estimated payments");
    expect(penaltyRule(null, false, 100_000)).toContain("underpayment penalty");
    expect(penaltyRule("yes", false, 100_000)).toContain("underpayment penalty");
    // A nonresident's year isn't covered by the exception.
    expect(penaltyRule("no", true, 100_000)).toContain("underpayment penalty");
  });

  it("gives California's date only to someone there, and the return's after the last payment", () => {
    expect(datesLine("2026-11-17", "NY")).not.toContain("California");
    expect(datesLine("2026-11-17", "CA")).toContain("California's next date is January 15, 2027");
    expect(datesLine("2026-06-16", "CA")).toContain(
      "The next federal estimated payment date is September 15, 2026",
    );
    // September's California share is 0%: its next date with money due is January's.
    expect(datesLine("2026-06-16", "CA")).toContain("California's next date is January 15, 2027");
    expect(datesLine("2027-01-16", "CA")).toBe("The 2026 return is due April 15, 2027.");
  });
});

describe("a student on an F or J visa", () => {
  it("hears what they file and that the resident credits aren't theirs", () => {
    const s = run(
      student([stipend("2026-11-02")], { tax_residency: "student_visa" }),
      "student_tax_residency",
    )!;
    // Which forms is the IRS's and Bechtel's to say, not Jane's (suggestions wording check, 11-18).
    expect(s.why).toContain(
      "Which forms a nonresident files, Form 8843 among them, is on Bechtel's pages and the IRS's",
    );
    expect(s.why).toContain("turns on the IRS's substantial presence test");
    expect(s.why).not.toMatch(/\bfiles Form\b|Form 1040-NR/);
    expect(s.why).toContain("withholds 30%");
    expect(s.required).toBe(true);
    expect(s.confidence.percent).toBe(100);
    expect(s.more?.map((m) => m.href)).toEqual(
      expect.arrayContaining([
        "https://www.irs.gov/forms-pubs/about-form-8843",
        "https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test",
      ]),
    );
    passesGuardrails(s);
  });

  it("is for no one else", () => {
    for (const tax_residency of ["citizen", "other_visa", "unsure"])
      expect(
        run(student([stipend("2026-11-02")], { tax_residency }), "student_tax_residency"),
      ).toBeNull();
    expect(run(student([stipend("2026-11-02")]), "student_tax_residency")).toBeNull();
  });
});
