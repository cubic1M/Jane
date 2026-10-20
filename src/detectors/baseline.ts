import type { PersonId } from "@/config/people";

// What each sample person's suggestions are today (spec step 258): the topics that fire, as
// the harness (./harness.ts) finds them. The test in ./reach.test.ts, and so the nightly CI
// run, fails when a person loses one of these (a right suggestion gone) or gains one on their
// must-not list (a wrong one). When a detector is added or changed on purpose, update this to
// match and say why in the PR: that is the review of the change.

export const BASELINE: Readonly<Record<PersonId, readonly string[]>> = {
  renter: ["bank_fees", "card_interest", "emergency_fund", "employer_match", "subscriptions"],
  family: [
    "education_529",
    "emergency_fund",
    "household_setup",
    "life_checklist",
    "life_insurance",
    "pmi_removal",
    "subscriptions",
  ],
  freelancer: [
    "emergency_fund",
    "estimated_taxes",
    "income_smoothing",
    "retirement_self_employed",
    "subscriptions",
  ],
  equity: ["backdoor_roth", "concentration", "hsa", "idle_cash", "refinance", "subscriptions"],
  preretire: ["catch_up", "household_setup", "idle_cash"],
  retiree: ["idle_cash", "rmd", "subscriptions"],
  debt: [
    "bank_fees",
    "card_interest",
    "debt_plan",
    "emergency_fund",
    "hardship_plan",
    "high_cost_loans",
    "late_fees",
    "subscriptions",
  ],
  owner: [
    "business_insurance",
    "business_separation",
    "emergency_fund",
    "estimated_taxes",
    "retirement_self_employed",
  ],
};
