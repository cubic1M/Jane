import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, type ProfileInput, type Told } from "@/profile/build";
import { federalTaxOf } from "@/planning/student-tax";
import { STUDENT_SHAPES, STUDENT_TODAY, inputFromStatements } from "./__fixtures__/student-walk";
import { STUDENT_WITHHOLDING_DETECTORS, withheldPerCheck } from "./student-withholding";
import { runDetectors, type Suggestion } from "./index";

// Withholding that's off and the extension that doesn't move the payment (suggest-taxes, 11-18):
// each rule applies, doesn't, the edges of its thresholds, and a thin-data student.

const tx = (date: string, amountCents: number, description: string, pfc: string | null = null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
const every = (from: string, to: string, days: number) => {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += days * 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
const groceries = (from: string, to = STUDENT_TODAY) =>
  every(from, to, 14).map((d) =>
    tx(d, 6_000, "SAFEWAY #1234 MOUNTAIN VIEW CA", "FOOD_AND_DRINK_GROCERIES"),
  );
const input = (
  rows: ReturnType<typeof tx>[],
  told: Told = {},
  today = STUDENT_TODAY,
): ProfileInput => ({
  today,
  transactions: rows,
  accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 300_000 }],
  liabilities: [],
  told,
});
const run = (data: ProfileInput, topic: string) =>
  runDetectors({ profile: buildProfile(data), data }, STUDENT_WITHHOLDING_DETECTORS).find(
    (s) => s.topic === topic,
  ) ?? null;
const passes = (s: Suggestion) => {
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

describe("Pub. 15-T withholding on a paycheck", () => {
  it("withholds nothing on a year's pay up to $16,100, then 10%", () => {
    // $670.83 twice a month is $16,099.92 a year.
    expect(withheldPerCheck(67_083, 24)).toBe(0);
    // $1,000 twice a month: $24,000 a year, $7,900 over: $790 / 24.
    expect(withheldPerCheck(100_000, 24)).toBe(Math.round(79_000 / 24));
  });
});

describe("a job that started this year", () => {
  const pay = (from: string, net = 198_540) =>
    every(from, STUDENT_TODAY, 15).map((d) =>
      tx(d, -net, "STANFORD UNIVERSITY PAYROLL", "INCOME_SALARY"),
    );

  it("finds the RA whose fall pay is withheld for a whole year, from two months of statement", async () => {
    const data = await inputFromStatements(STUDENT_SHAPES["ra-two-months"](), STUDENT_TODAY);
    const s = run(data, "withholding_part_year")!;
    expect(s.worthKind).toBe("earns");
    expect(s.why).toContain("part-year method");
    expect(s.why).toContain("245 days");
    // Six paychecks of about $2,581 are under the standard deduction: no tax, so the W-4's exempt box.
    expect(s.why).toContain("Exempt from withholding");
    expect(s.why).toContain("twice a month");
    passes(s);
  });

  it("sees a start only after more than 1.15 pay intervals of data with no pay", () => {
    // Data from Sep 15; pay every 15 days from Oct 3 (18 days): more than 17.25.
    expect(
      run(input([...groceries("2026-09-15"), ...pay("2026-10-03")]), "withholding_part_year"),
    ).not.toBeNull();
    // From Oct 1 (16 days): not enough to tell a start from a payday just missed.
    expect(
      run(input([...groceries("2026-09-15"), ...pay("2026-10-01")]), "withholding_part_year"),
    ).toBeNull();
  });

  it("is the year's withholding less the year's tax", () => {
    const data = input([...groceries("2026-07-01"), ...pay("2026-08-01", 400_000)]);
    const s = run(data, "withholding_part_year")!;
    // About $5,200 before deductions twice a month, paychecks from Aug 1 to Dec 31.
    const check = Math.round(400_000 * 1.3);
    const checks = Math.floor(152 / 15) + 1;
    expect(s.worthCents).toBe(
      withheldPerCheck(check, 24) * checks - federalTaxOf(check * checks, "single", false),
    );
    expect(s.why).not.toContain("Exempt from withholding");
  });

  it("says nothing for pay all year, a fellow, a joint return, or a refund under $100", () => {
    expect(
      run(input([...groceries("2026-09-15"), ...pay("2026-09-15")]), "withholding_part_year"),
    ).toBeNull();
    expect(
      run(
        input([
          ...groceries("2026-09-15"),
          ...pay("2026-10-03"),
          tx("2026-10-05", -475_000, "STANFORD UNIV FELLOWSHIP STIPEND"),
        ]),
        "withholding_part_year",
      ),
    ).toBeNull();
    expect(
      run(
        input([...groceries("2026-09-15"), ...pay("2026-10-03")], {
          filing_status: "married_joint",
        }),
        "withholding_part_year",
      ),
    ).toBeNull();
    // $500 a paycheck is $15,600 a year grossed up: nothing withheld to come back.
    expect(
      run(
        input([...groceries("2026-09-15"), ...pay("2026-10-03", 50_000)]),
        "withholding_part_year",
      ),
    ).toBeNull();
  });
});

describe("two jobs at once", () => {
  const job = (name: string, net: number, from = "2026-09-04") =>
    every(from, STUDENT_TODAY, 14).map((d) => tx(d, -net, `${name} PAYROLL`, "INCOME_SALARY"));

  it("finds each job taking the whole standard deduction", () => {
    const s = run(
      input([
        ...groceries("2026-09-01"),
        ...job("ACME CORP", 90_000),
        ...job("BLUE BOTTLE", 70_000, "2026-09-05"),
      ]),
      "withholding_two_jobs",
    )!;
    expect(s.worthKind).toBe("risk");
    expect(s.why).toContain("Step 2");
    expect(s.why).toContain("Acme Corp");
    passes(s);
  });

  it("says nothing for one job, three, or two small enough to owe nothing", () => {
    expect(
      run(input([...groceries("2026-09-01"), ...job("ACME CORP", 90_000)]), "withholding_two_jobs"),
    ).toBeNull();
    expect(
      run(
        input([
          ...groceries("2026-09-01"),
          ...job("ACME CORP", 90_000),
          ...job("BLUE BOTTLE", 70_000),
          ...job("TRADER JOES", 30_000),
        ]),
        "withholding_two_jobs",
      ),
    ).toBeNull();
    expect(
      run(
        input([
          ...groceries("2026-09-01"),
          ...job("ACME CORP", 20_000),
          ...job("BLUE BOTTLE", 20_000),
        ]),
        "withholding_two_jobs",
      ),
    ).toBeNull();
  });
});

describe("the extension that doesn't move the payment", () => {
  const gig = (year: number) =>
    every(`${year}-09-01`, `${year}-12-20`, 7).map((d) =>
      tx(d, -40_000, "DOORDASH DASHER PAYMENT", "INCOME_GIG_ECONOMY"),
    );

  it("is for someone with last year's untaxed income, from March 1 to April 15", () => {
    const rows = [...groceries("2026-09-01", "2027-03-30"), ...gig(2026)];
    const s = run(input(rows, {}, "2027-03-20"), "filing_extension")!;
    expect(s.why).toContain("October 15, 2027");
    expect(s.why).toContain("April 15, 2027");
    expect(s.worthCents).toBeGreaterThan(0);
    passes(s);
    expect(run(input(rows, {}, "2027-03-01"), "filing_extension")).not.toBeNull();
    expect(run(input(rows, {}, "2027-04-15"), "filing_extension")?.urgency).toBe("now");
    expect(run(input(rows, {}, "2027-02-28"), "filing_extension")).toBeNull();
    expect(run(input(rows, {}, "2027-04-16"), "filing_extension")).toBeNull();
  });

  it("isn't for pay with withholding, or someone on a student visa", () => {
    const pay = every("2026-09-01", "2026-12-20", 14).map((d) =>
      tx(d, -200_000, "ACME CORP PAYROLL", "INCOME_SALARY"),
    );
    expect(
      run(
        input([...groceries("2026-09-01", "2027-03-30"), ...pay], {}, "2027-03-20"),
        "filing_extension",
      ),
    ).toBeNull();
    expect(
      run(
        input(
          [...groceries("2026-09-01", "2027-03-30"), ...gig(2026)],
          { tax_residency: "student_visa" },
          "2027-03-20",
        ),
        "filing_extension",
      ),
    ).toBeNull();
  });
});
