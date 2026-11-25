import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput, type Told } from "@/profile/build";
import { federalTaxOf } from "@/planning/student-tax";
import { selfEmploymentTax } from "@/planning/tax-estimate";
import { STUDENT_TODAY } from "./__fixtures__/student-walk";
import { STUDENT_WITHHOLDING_DETECTORS } from "./student-withholding";
import { runDetectors } from "./index";
import { observedFilingDay } from "@/lib/filing-day";

// CodeRabbit sweep 1c, det-04: the withholding cards' claims (an estimate under the default W-4,
// two jobs running at once, a deposit counted once, the filing-year calendar).

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

describe("excess withholding is an estimate (finding 17)", () => {
  it("is conditional on the default W-4 in every line", () => {
    const pay = every("2026-08-01", STUDENT_TODAY, 15).map((d) =>
      tx(d, -400_000, "STANFORD UNIVERSITY PAYROLL", "INCOME_SALARY"),
    );
    const s = run(input([...groceries("2026-07-01"), ...pay]), "withholding_part_year")!;
    expect(s.title).toMatch(/^If your new job withholds as the default W-4 does/);
    expect(s.headline).toContain("may be over-withheld");
    expect(s.short).toContain("may be withheld");
    expect(s.why).toContain("your W-4 is the default one");
    expect(s.why).toContain("I see your take-home deposits, not what was withheld");
  });
});

describe("two jobs at once (finding 3)", () => {
  const job = (name: string, net: number, from: string, to = STUDENT_TODAY) =>
    every(from, to, 14).map((d) => tx(d, -net, `${name} PAYROLL`, "INCOME_SALARY"));

  it("is nothing for a job left in June and another started in July", () => {
    const data = input([
      ...groceries("2026-01-02"),
      ...job("ACME CORP", 90_000, "2026-01-02", "2026-06-12"),
      ...job("BLUE BOTTLE", 70_000, "2026-07-10"),
    ]);
    expect(run(data, "withholding_two_jobs")).toBeNull();
  });

  it("is nothing when one job's pay stopped weeks ago", () => {
    const data = input([
      ...groceries("2026-09-01"),
      ...job("ACME CORP", 90_000, "2026-09-04", "2026-10-02"),
      ...job("BLUE BOTTLE", 70_000, "2026-09-05"),
    ]);
    expect(run(data, "withholding_two_jobs")).toBeNull();
  });

  it("still finds two jobs running side by side", () => {
    const data = input([
      ...groceries("2026-09-01"),
      ...job("ACME CORP", 90_000, "2026-09-04"),
      ...job("BLUE BOTTLE", 70_000, "2026-09-05"),
    ]);
    expect(run(data, "withholding_two_jobs")).not.toBeNull();
  });
});

describe("a deposit counted once (finding 7)", () => {
  const rows = (deposits: ReturnType<typeof tx>[]) => [
    ...groceries("2026-09-01", "2027-03-30"),
    ...deposits,
  ];
  const stipends = ["2026-10-01", "2026-11-01", "2026-12-01"].map((d) =>
    tx(d, -1_200_000, "STANFORD UNIV FELLOWSHIP STIPEND", "INCOME_CONTRACTOR"),
  );

  it("counts a Stanford stipend the bank filed as contract pay once, with no self-employment tax", () => {
    const s = run(input(rows(stipends), {}, "2027-03-20"), "filing_extension")!;
    expect(s.worthCents).toBe(federalTaxOf(3_600_000, "single", false, 3_600_000));
  });

  it("keeps contract pay in the self-employment calculation", () => {
    const contract = ["2026-10-01", "2026-11-01", "2026-12-01"].map((d) =>
      tx(d, -1_200_000, "ACME CONSULTING INVOICE", "INCOME_CONTRACTOR"),
    );
    const s = run(input(rows(contract), {}, "2027-03-20"), "filing_extension")!;
    expect(s.worthCents).toBe(
      federalTaxOf(3_600_000, "single", false, 3_600_000) + selfEmploymentTax(3_600_000, 0),
    );
  });
});

describe("the return's filing-year calendar (finding 13)", () => {
  it("moves a Saturday April 15 past Emancipation Day, and a Sunday October 15 to Monday", () => {
    expect(observedFilingDay("2028-04-15")).toBe("2028-04-18");
    expect(observedFilingDay("2028-10-15")).toBe("2028-10-16");
    expect(observedFilingDay("2027-04-15")).toBe("2027-04-15");
  });

  it("gives the 2027 return's real dates and still shows on the old April 15", () => {
    const gig = every("2027-09-01", "2027-12-20", 7).map((d) =>
      tx(d, -40_000, "DOORDASH DASHER PAYMENT", "INCOME_GIG_ECONOMY"),
    );
    const rows = [...groceries("2027-09-01", "2028-04-17"), ...gig];
    const s = run(input(rows, {}, "2028-04-17"), "filing_extension")!;
    expect(s.why).toContain("April 18, 2028");
    expect(s.why).not.toContain("April 15, 2028");
    expect(s.why).toContain("October 16, 2028");
    expect(run(input(rows, {}, "2028-04-19"), "filing_extension")).toBeNull();
  });
});
