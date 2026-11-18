import type { SuggestionTopic } from "@/config/people";
import type { FactKey } from "@/profile/facts";

// The one question worth asking (spec step 257): facts the data can't show, each asked in
// the chat with tap answers when a detector (src/detectors) could fire if it knew. The
// "unlock" figures only order the questions: what the answer could make worth acting on, at
// typical rates. They are never shown as a claim.

type QuestionChoice = { label: string; value: string };
export type QuestionSpec = {
  fact: FactKey;
  text: string;
  // At most four answers; "Skip" is always the fifth button.
  choices: readonly QuestionChoice[];
  // What it would unlock.
  topics: readonly SuggestionTopic[];
  // Said with the question: "It decides 3 credits and deductions worth up to $2,860 for you", the
  // count and dollars worked out from the detectors that need the fact (src/profile/questions.ts).
  // The words for one and for several.
  decides?: readonly [one: string, several: string];
};

export const QUESTIONS: readonly QuestionSpec[] = [
  {
    fact: "employer_match",
    text: "Does your job match what you put into your 401(k)?",
    choices: [
      { label: "Yes, it matches", value: "yes" },
      { label: "No match", value: "no" },
    ],
    topics: ["employer_match"],
  },
  {
    fact: "age_band",
    text: "Roughly how old are you? It changes what's worth doing with your money.",
    choices: [
      { label: "Under 58", value: "50_to_57" },
      { label: "58 to 65", value: "58_to_65" },
      { label: "66 to 72", value: "66_to_72" },
      { label: "73 or older", value: "73_plus" },
    ],
    topics: ["social_security_timing", "medicare", "catch_up", "rmd"],
  },
  {
    fact: "filing_status",
    text: "How do you file your taxes?",
    choices: [
      { label: "Single", value: "single" },
      { label: "Married, together", value: "married_joint" },
      { label: "Married, separately", value: "married_separate" },
      { label: "Head of household", value: "head_of_household" },
    ],
    topics: ["estimated_taxes", "withholding_gap", "backdoor_roth"],
  },
  {
    fact: "business_structure",
    text: "How is your business set up?",
    choices: [
      { label: "Just me (sole proprietor)", value: "sole_proprietor" },
      { label: "An LLC", value: "llc" },
      { label: "An S corporation", value: "s_corp" },
      { label: "Something else", value: "other" },
    ],
    topics: ["estimated_taxes", "retirement_self_employed", "business_insurance"],
  },
  // Students' taxes (suggest-taxes, 11-18): one tap each, "Not sure" is an answer too.
  {
    fact: "school_deposit",
    text: "Is the money from your school a fellowship, grant or stipend, pay for work, or loan money?",
    choices: [
      // A grant or scholarship beyond tuition and required books is income just as a fellowship is
      // (Pub. 970); loan money isn't.
      { label: "Fellowship, grant or stipend", value: "fellowship" },
      { label: "Pay for work (RA, TA)", value: "wage" },
      { label: "Loan money", value: "aid_refund" },
      { label: "Not sure", value: "unsure" },
    ],
    topics: ["stipend_tax"],
    decides: ["tax figure", "tax figures"],
  },
  {
    fact: "claimed_as_dependent",
    text: "Can a parent or anyone else claim you as a dependent on their taxes?",
    choices: [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
      { label: "Not sure", value: "unsure" },
    ],
    topics: ["stipend_tax"],
    decides: ["credit or deduction", "credits and deductions"],
  },
  {
    fact: "tax_residency",
    text: "For US taxes, are you a citizen or green card holder, or here on a visa?",
    choices: [
      { label: "Citizen or green card", value: "citizen" },
      { label: "F or J student visa", value: "student_visa" },
      { label: "Another visa", value: "other_visa" },
      { label: "Not sure", value: "unsure" },
    ],
    topics: ["stipend_tax", "student_tax_residency"],
    decides: ["credit or form", "credits and forms"],
  },
  {
    fact: "enrollment",
    text: "Are you in school this year, at least half time?",
    choices: [
      { label: "Undergrad, half time or more", value: "undergrad" },
      { label: "Grad, half time or more", value: "grad" },
      { label: "Less than half time", value: "less_than_half" },
      { label: "Not in school", value: "not_enrolled" },
    ],
    topics: ["education_credit", "savers_credit"],
    decides: ["credit", "credits"],
  },
  {
    fact: "age_25_plus",
    text: "Will you be 25 or older by December 31?",
    choices: [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
      { label: "Not sure", value: "unsure" },
    ],
    topics: ["earned_income_credit", "education_credit"],
    decides: ["credit", "credits"],
  },
  {
    fact: "home_state",
    text: "Do you live in California?",
    choices: [
      { label: "Yes", value: "CA" },
      { label: "Another state", value: "other" },
      { label: "Not sure", value: "unsure" },
    ],
    topics: ["ca_renters_credit"],
    decides: ["credit or date", "credits and dates"],
  },
  {
    fact: "owed_tax_last_year",
    text: "Did you owe any federal income tax for 2025, after credits?",
    choices: [
      { label: "Yes", value: "yes" },
      { label: "No, none", value: "no" },
      { label: "Not sure", value: "unsure" },
    ],
    topics: ["stipend_tax"],
    decides: ["penalty rule", "penalty rules"],
  },
  {
    fact: "hardship_reason",
    text: "What got you into debt trouble? It decides which help to ask for.",
    choices: [
      { label: "Lost income", value: "job_loss" },
      { label: "Medical bills", value: "medical" },
      { label: "Spending more than I earned", value: "overspending" },
      { label: "Something else", value: "other" },
    ],
    topics: ["hardship_plan", "debt_plan"],
  },
  {
    fact: "is_student",
    text: "Are you a student right now? Some savings are only for students.",
    choices: [
      { label: "Yes, I'm a student", value: "yes" },
      { label: "No", value: "no" },
    ],
    topics: ["free_through_school", "transit_pass", "cardinal_care_check", "student_checking"],
  },
];

// Typical rates for what an answer could unlock (cents are computed from the person's own
// income and debts).
export const UNLOCK = {
  // A typical employer match, as a share of pay.
  matchShareOfPay: 0.03,
  // How much the right filing status moves tax estimates, as a share of income.
  filingShareOfIncome: 0.02,
  // How much the business set-up moves taxes and retirement choices, as a share of income.
  structureShareOfIncome: 0.03,
  // The right kind of hardship help, as a share of a year's interest and fees.
  hardshipShareOfCosts: 0.5,
  // Knowing the age band near or in retirement (Social Security timing, Medicare, catch-up
  // contributions, required withdrawals): a typical yearly amount at stake.
  ageApproachingCents: 1_200_000,
  ageRetiredCents: 600_000,
  // Knowing someone paid by a university is a student: a student price, a pass or a plan they
  // may be paying for twice, at a typical yearly amount.
  studentCents: 30_000,
} as const;
