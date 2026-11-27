import { describe, expect, it } from "vitest";
import { NO_INCOME, type EstimateInput } from "@/planning/tax-estimate";
import { careChoice, type Child } from "@/planning/family-taxes";
import { childrenOrUnknownAges, type FamilyView } from "@/lib/family-taxes";
import { familyReply } from "./family-taxes-message";

// The chat reads the same result as the page: unknown ages are "depends on the ages", not
// "not open to you".

const estimate: EstimateInput = {
  year: 2026,
  filingStatus: "single",
  childrenUnder17: 1,
  otherDependants: 0,
  state: "NY",
  income: { ...NO_INCOME, wagesCents: 9_000_000, socialSecurityWagesCents: 9_000_000 },
  studentLoanInterestCents: 0,
  mortgageInterestCents: 0,
  charityCents: 0,
  medicalCents: 0,
  otherStateLocalTaxCents: 0,
  federalWithheldCents: 0,
  federalEstimatedPaidCents: 0,
  stateWithheldCents: 0,
  stateEstimatedPaidCents: 0,
};
const reply = (children: Child[]) => {
  const view: FamilyView = {
    year: 2026,
    advice: true,
    choices: [careChoice({ estimate, careCents: 800_000, children, bothWork: true })!],
    assumptions: [],
    agesMissing: true,
  };
  return familyReply(view).body;
};

describe("the chat's family tax reply", () => {
  it("a count with no ages comes out unknown, and the chat says so", () => {
    const children = childrenOrUnknownAges(null, 2);
    expect(children.every((c) => c.ageUnknown)).toBe(true);
    const body = reply(children);
    expect(body).toContain("depends on your children's ages");
    expect(body).not.toMatch(/not open to you/i);
    expect(body).not.toMatch(/less\)/);
  });

  it("recorded ages 13 or older still say not open", () => {
    expect(reply([{ ageAtYearEnd: 14, hasSsn: true, monthsLivedWithYou: 12 }])).toMatch(
      /not open to you \(Care counts for a child under 13/,
    );
  });
});
