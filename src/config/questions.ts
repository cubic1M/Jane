import type { SuggestionTopic } from "@/config/people";
import type { FactKey } from "@/profile/facts";

// The one question worth asking (spec step 257): facts the data can't show, each asked in
// the chat with tap answers when a detector (src/detectors) could fire if it knew. The
// "unlock" figures only order the questions: what the answer could make worth acting on, at
// typical rates. They are never shown as a claim.

export type QuestionChoice = { label: string; value: string };
export type QuestionSpec = {
  fact: FactKey;
  text: string;
  // At most four answers; "Skip" is always the fifth button.
  choices: readonly QuestionChoice[];
  // What it would unlock.
  topics: readonly SuggestionTopic[];
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
} as const;
