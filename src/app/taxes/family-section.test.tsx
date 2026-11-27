import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FamilyView } from "@/lib/family-taxes";
import { NO_INCOME, type EstimateInput } from "@/planning/tax-estimate";
import { careChoice, type Child } from "@/planning/family-taxes";
import { FamilySection } from "./family-section";

// Care credit wording when the children's ages are unknown (tax fix, after #2336): unknown is
// shown as "depends on the ages", never as "Not open to you"; known ages keep both answers.

const estimate: EstimateInput = {
  year: 2026,
  filingStatus: "married_joint",
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
const page = (children: Child[]) => {
  const choice = careChoice({ estimate, careCents: 1_000_000, children, bothWork: true })!;
  const view: FamilyView = {
    year: 2026,
    advice: true,
    choices: [choice],
    assumptions: [],
    agesMissing: children.some((c) => c.ageUnknown),
  };
  return renderToStaticMarkup(<FamilySection view={view} />);
};
const kid = (age: number, over: Partial<Child> = {}): Child => ({
  ageAtYearEnd: age,
  hasSsn: true,
  monthsLivedWithYou: 12,
  ...over,
});

describe("Family tax choices: the care credit and the children's ages", () => {
  it("never says 'Not open to you' when the ages are unknown", () => {
    const html = page([kid(16, { ageUnknown: true })]);
    expect(html).not.toContain("Not open to you");
    expect(html).toContain("May be open to you");
    expect(html).toContain("Depends on ages");
    expect(html).not.toContain("Less tax");
  });

  it("keeps 'Not open to you' with the reason when every child is 13 or older", () => {
    const html = page([kid(13), kid(15)]);
    expect(html).toContain("Not open to you: Care counts for a child under 13.");
  });

  it("shows both figures and the better side when a child is under 13", () => {
    const html = page([kid(4)]);
    expect(html).not.toContain("Not open to you");
    expect(html).not.toContain("Depends on ages");
    expect(html).toContain("Less tax");
  });
});
