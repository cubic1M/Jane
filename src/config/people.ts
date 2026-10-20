// The eight sample people (spec step 252): different lives to prove suggestions on, not one.
// Each has a written list of what Jane should suggest and what she must not; the detector
// harness (step 254) checks every detector against these lists. The demo bank data for each
// is in src/data-sources/demo/demo-people.ts.

// What a suggestion is about, in words detectors (step 254) are mapped to. Kept short and
// stable: the lists below and the harness both use them.
export const SUGGESTION_TOPICS = [
  "subscriptions",
  "bank_fees",
  "late_fees",
  "card_interest",
  "high_cost_loans",
  "debt_plan",
  "hardship_plan",
  "credit_building",
  "emergency_fund",
  "idle_cash",
  "employer_match",
  "catch_up",
  "hsa",
  "backdoor_roth",
  "concentration",
  "withholding_gap",
  "estimated_taxes",
  "retirement_self_employed",
  "income_smoothing",
  "health_insurance",
  "life_insurance",
  "long_term_care",
  "medigap",
  "business_insurance",
  "business_separation",
  "cash_flow",
  "pmi_removal",
  "life_checklist",
  "household_setup",
  "refinance",
  // Spec step 260: debt and credit.
  "student_repayment",
  "auto_refinance",
  "car_addons",
  "cash_advance",
  "mortgage_extra",
  "balance_transfer",
  "education_529",
  "social_security_timing",
  "medicare",
  "rmd",
  "roth_conversion",
  "childcare_tax_break",
  "identity_ip_pin",
  "year_end_moves",
] as const;
export type SuggestionTopic = (typeof SUGGESTION_TOPICS)[number];

export const PERSON_IDS = [
  "renter",
  "family",
  "freelancer",
  "equity",
  "preretire",
  "retiree",
  "debt",
  "owner",
] as const;
export type PersonId = (typeof PERSON_IDS)[number];

// What a person's profile (step 253) should say about them, in words the profile builder
// and its test share.
export type PersonFacts = {
  income: "salary" | "uneven" | "business" | "pension";
  lifeStage: "starting" | "raising" | "peak" | "approaching" | "retired";
  household: "single" | "family" | "couple";
  owns: "rent" | "home";
  hasDebtTrouble: boolean;
};

export type Person = {
  id: PersonId;
  name: string;
  label: string;
  // One line for the Try Jane picker.
  blurb: string;
  facts: PersonFacts;
  should: readonly SuggestionTopic[];
  mustNot: readonly SuggestionTopic[];
  // The question worth asking them first (step 257): the fact whose answer unlocks most.
  firstQuestion: string;
};

export const PEOPLE: readonly Person[] = [
  {
    id: "renter",
    name: "Maya",
    label: "Young renter, first job",
    blurb: "24, renting, first job, a card balance and a small student loan",
    facts: {
      income: "salary",
      lifeStage: "starting",
      household: "single",
      owns: "rent",
      hasDebtTrouble: false,
    },
    should: [
      "subscriptions",
      "bank_fees",
      "card_interest",
      "employer_match",
      "emergency_fund",
      "balance_transfer",
    ],
    mustNot: [
      "pmi_removal",
      "refinance",
      "rmd",
      "medicare",
      "estimated_taxes",
      "concentration",
      "education_529",
      "roth_conversion",
      "childcare_tax_break",
      "catch_up",
      "backdoor_roth",
      "hsa",
      "household_setup",
      "life_checklist",
    ],
    firstQuestion: "employer_match",
  },
  {
    id: "family",
    name: "The Reyes family",
    label: "Family with kids and a mortgage",
    blurb: "Two earners, two kids, a mortgage with PMI, childcare",
    facts: {
      income: "salary",
      lifeStage: "raising",
      household: "family",
      owns: "home",
      hasDebtTrouble: false,
    },
    should: [
      "pmi_removal",
      "life_insurance",
      "education_529",
      "subscriptions",
      "emergency_fund",
      "childcare_tax_break",
      "life_checklist",
      "household_setup",
    ],
    mustNot: [
      "refinance",
      "rmd",
      "medicare",
      "estimated_taxes",
      "hardship_plan",
      "social_security_timing",
      "roth_conversion",
      "backdoor_roth",
      "catch_up",
    ],
    firstQuestion: "employer_match",
  },
  {
    id: "freelancer",
    name: "Sam",
    label: "Freelancer with uneven income",
    blurb: "Paid by clients at irregular times, no employer, no tax withheld",
    facts: {
      income: "uneven",
      lifeStage: "peak",
      household: "single",
      owns: "rent",
      hasDebtTrouble: false,
    },
    should: [
      "estimated_taxes",
      "retirement_self_employed",
      "income_smoothing",
      "health_insurance",
      "emergency_fund",
    ],
    mustNot: [
      "employer_match",
      "rmd",
      "pmi_removal",
      "medicare",
      "hardship_plan",
      "roth_conversion",
      "childcare_tax_break",
      "household_setup",
      "life_checklist",
    ],
    firstQuestion: "filing_status",
  },
  {
    id: "equity",
    name: "Priya",
    label: "High earner with stock pay",
    blurb: "Big salary and company stock vesting, a lot of idle cash",
    facts: {
      income: "salary",
      lifeStage: "peak",
      household: "single",
      owns: "home",
      hasDebtTrouble: false,
    },
    should: [
      "idle_cash",
      "concentration",
      "withholding_gap",
      "hsa",
      "backdoor_roth",
      "refinance",
      "mortgage_extra",
    ],
    mustNot: [
      "bank_fees",
      "late_fees",
      "hardship_plan",
      "medicare",
      "rmd",
      "credit_building",
      "roth_conversion",
      "childcare_tax_break",
      "household_setup",
      "life_checklist",
    ],
    firstQuestion: "employer_match",
  },
  {
    id: "preretire",
    name: "Dan and Lena",
    label: "Couple near retirement",
    blurb: "Early 60s, still working, a nearly paid-off home and a big 401(k)",
    facts: {
      income: "salary",
      lifeStage: "approaching",
      household: "couple",
      owns: "home",
      hasDebtTrouble: false,
    },
    should: [
      "social_security_timing",
      "medicare",
      "long_term_care",
      "catch_up",
      "idle_cash",
      "roth_conversion",
      "household_setup",
    ],
    mustNot: [
      "education_529",
      "credit_building",
      "estimated_taxes",
      "hardship_plan",
      "employer_match",
      "childcare_tax_break",
      "life_checklist",
    ],
    firstQuestion: "age_band",
  },
  {
    id: "retiree",
    name: "Ruth",
    label: "Retiree",
    blurb: "71, Social Security and a pension, withdrawing from an IRA",
    facts: {
      income: "pension",
      lifeStage: "retired",
      household: "single",
      owns: "home",
      hasDebtTrouble: false,
    },
    should: ["rmd", "medigap", "idle_cash", "subscriptions"],
    mustNot: [
      "employer_match",
      "education_529",
      "estimated_taxes",
      "catch_up",
      "hsa",
      "refinance",
      "credit_building",
      "childcare_tax_break",
      "household_setup",
      "life_checklist",
    ],
    firstQuestion: "age_band",
  },
  {
    id: "debt",
    name: "Chris",
    label: "Someone in debt trouble",
    blurb: "Many cards near their limits, overdrafts, a payday loan",
    facts: {
      income: "salary",
      lifeStage: "starting",
      household: "single",
      owns: "rent",
      hasDebtTrouble: true,
    },
    should: [
      "card_interest",
      "bank_fees",
      "late_fees",
      "high_cost_loans",
      "debt_plan",
      "hardship_plan",
      "balance_transfer",
    ],
    mustNot: [
      "concentration",
      "backdoor_roth",
      "hsa",
      "idle_cash",
      "refinance",
      "catch_up",
      "rmd",
      // Spec step 260: extra money on a mortgage they don't have.
      "mortgage_extra",
      "roth_conversion",
      "childcare_tax_break",
      "household_setup",
      "life_checklist",
    ],
    firstQuestion: "hardship_reason",
  },
  {
    id: "owner",
    name: "Jo",
    label: "Small-business owner",
    blurb: "Runs a shop through an LLC, business and personal money mixed",
    facts: {
      income: "business",
      lifeStage: "peak",
      household: "single",
      owns: "rent",
      hasDebtTrouble: false,
    },
    should: [
      "estimated_taxes",
      "business_separation",
      "business_insurance",
      "retirement_self_employed",
      "cash_flow",
    ],
    mustNot: [
      "employer_match",
      "rmd",
      "pmi_removal",
      "medicare",
      "hardship_plan",
      "roth_conversion",
      "childcare_tax_break",
      "household_setup",
      "life_checklist",
    ],
    firstQuestion: "business_structure",
  },
];

export const personById = (id: string): Person | undefined => PEOPLE.find((p) => p.id === id);
export const isPersonId = (id: string): id is PersonId =>
  (PERSON_IDS as readonly string[]).includes(id);
