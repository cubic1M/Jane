import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput, type Told } from "@/profile/build";
import { runDetectors } from "./index";
import { STUDENT_TAX_DETECTORS, datesLine, penaltyRule } from "./student-taxes";
import { STUDENT_TODAY } from "./__fixtures__/student-walk";

// CodeRabbit sweep 1c, det-04: the Stanford tax cards say only what the rules and the deposits
// support (rate not quoted, both filing-status cutoffs, the income year's schedule, an unknown
// deposit kept conditional).

const tx = (date: string, amountCents: number, description: string, pfc: string | null = null) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "checking",
});
function student(deposits: ReturnType<typeof tx>[], told: Told = {}, today = STUDENT_TODAY) {
  const groceries = ["2026-09-18", "2026-10-02", "2026-10-16", "2026-10-30", "2026-11-13"].map(
    (d) => tx(d, 6_000, "SAFEWAY #1234 MOUNTAIN VIEW CA", "FOOD_AND_DRINK_GROCERIES"),
  );
  return {
    today,
    transactions: [...groceries, ...deposits],
    accounts: [{ id: "checking", type: "depository", subtype: "checking", balanceCents: 300_000 }],
    liabilities: [],
    told,
  } as ProfileInput;
}
const run = (data: ProfileInput, topic = "stipend_tax") =>
  runDetectors({ profile: buildProfile(data), data }, STUDENT_TAX_DETECTORS).find(
    (s) => s.topic === topic,
  ) ?? null;
const refund = (date: string) =>
  tx(date, -475_000, "STANFORD UNIV STUDENT ACCT REFUND PPD ID: 1946001");
const stipend = (date: string) =>
  tx(date, -475_000, "STANFORD UNIV FELLOWSHIP STIPEND PPD ID: 1946001");

describe("the F/J card's withholding rate (finding 1)", () => {
  it("does not quote 30%: Stanford's pages differ, so it says the rate depends on visa and treaty", () => {
    const s = run(
      student([stipend("2026-11-02")], { tax_residency: "student_visa" }),
      "student_tax_residency",
    )!;
    expect(s.why).not.toMatch(/\d+%/);
    expect(s.why).toContain("depends on your visa");
  });
});

describe("the safe-harbour and California cutoffs (findings 4 and 10)", () => {
  it("states the separate-filer AGI cutoff beside the general one", () => {
    const text = penaltyRule(null, false, 100_000);
    expect(text).toContain("$150,000");
    expect(text).toContain("$75,000 for a married person on a separate return");
  });
  it("states California's separate-filer threshold beside the general one", () => {
    const text = datesLine("2026-11-17", "CA");
    expect(text).toContain("$500");
    expect(text).toContain(
      "$250 for a married person or registered domestic partner on a separate return",
    );
  });
});

describe("the income year's schedule (finding 5)", () => {
  it("holds a 2027 estimate back instead of pricing it with 2026 law", () => {
    const data = student(
      [stipend("2027-10-01"), stipend("2027-11-02")],
      { home_state: "CA" },
      "2027-11-15",
    );
    data.transactions = [
      ...["2027-09-18", "2027-10-02", "2027-10-16", "2027-10-30", "2027-11-13"].map((d) =>
        tx(d, 6_000, "SAFEWAY #1234 MOUNTAIN VIEW CA", "FOOD_AND_DRINK_GROCERIES"),
      ),
      ...data.transactions.filter((t) => t.amountCents < 0),
    ];
    // Jane has no IRS figures for 2027, so a card that prices its tax is held back, never priced
    // with 2026 law and labelled 2027 (and so never carries 2026's deadlines either).
    expect(run(data)).toBeNull();
    expect(run(data, "withholding_two_jobs")).toBeNull();
  });
});

describe("an unknown school deposit (finding 9)", () => {
  it("is a scenario in the title, headline and short, until it is confirmed", () => {
    const s = run(student([refund("2026-10-01"), refund("2026-11-02")]))!;
    expect(s.title).toMatch(/^If these school deposits are a fellowship/);
    expect(s.title).not.toContain("your fellowship");
    expect(s.headline).toContain("if this is a fellowship");
    expect(s.short).toContain("if it's a fellowship");
  });
  it("keeps the plain wording for a confirmed or named fellowship", () => {
    const told = run(
      student([refund("2026-10-01"), refund("2026-11-02")], { school_deposit: "fellowship" }),
    )!;
    expect(told.title).toContain("Nothing is withheld from your fellowship");
    const named = run(student([stipend("2026-10-01"), stipend("2026-11-02")]))!;
    expect(named.title).toContain("Nothing is withheld from your fellowship");
  });
});
