import type { DropReaction, Goal, Horizon } from "@/config/investing";

// The eight sample people (spec step 252): different lives to prove suggestions on, not one.
// Each has a written list of what Jane should suggest and what it must not; the detector
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
  // Spec step 283: cards that could be one cheaper loan.
  "consolidation",
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
  // Insurance (spec step 259).
  "renters_insurance",
  "auto_insurance",
  "umbrella",
  "insurance_shopping",
  "insurance_negotiation",
  "insurance_claim",
  "cover_change",
  "card_cover",
  "employer_benefits",
  "policy_documents",
  "disability_insurance",
  "liability_levels",
  "deductible_fit",
  "fsa_deadline",
  "deductible_met",
  "medical_bill_dispute",
  "business_separation",
  "cash_flow",
  "pmi_removal",
  "life_checklist",
  "household_setup",
  // The profile's life facts (src/profile/life-facts.ts) change what is suggested.
  "pet_insurance",
  "student_discounts",
  "refinance",
  // Spec step 260: debt and credit.
  "student_repayment",
  "auto_refinance",
  "car_addons",
  "cash_advance",
  "mortgage_extra",
  "balance_transfer",
  // Spec step 260, the rest of the debt tools.
  "bnpl",
  "medical_bills",
  "credit_report_errors",
  "student_forgiveness",
  "family_loans",
  // Spec step 263: spending, bills and cash.
  "duplicate_subscription",
  "price_increase",
  "trial_conversion",
  "bill_negotiation",
  "duplicate_charge",
  "low_balance",
  "budget_overrun",
  "education_529",
  // Spec step 248: renting, counted.
  "rent_reporting",
  "rent_increase",
  // Spec step 250: what you could borrow.
  "borrowing_power",
  // Spec step 249: helping family with credit.
  "family_credit",
  "cosign_risk",
  "social_security_timing",
  "medicare",
  "rmd",
  "roth_conversion",
  "childcare_tax_break",
  "identity_ip_pin",
  "year_end_moves",
  // Spec step 262: investing.
  "investment_fees",
  "rebalance",
  "auto_invest",
  "old_accounts",
  "asset_location",
  "costly_products",
  "plan_menu",
  "invested_cash",
  "short_term_cash",
  "sudden_money",
  "values_funds",
  "beneficiaries",
  "charity_receipts",
  "property_tax_check",
  "tax_loss_harvest",
  "file_return",
  // Spec step 243: an intro price ending, a yearly plan renewing.
  "promo_ending",
  // Spec step 239: a headline figure resting on something only the person knows.
  "figure_check",
  // Phase AP (spec steps 238–244): Jane runs the money.
  "data_problems",
  // Spec step 296: practice money first.
  "practice_portfolio",
  "s_corp_election",
  "home_office_deduction",
  "vehicle_deduction",
  // An inherited IRA: the deadline (a fact) and spreading the withdrawals (demo advice).
  "inherited_ira",
  "inherited_ira_spread",
  "ptc_repayment",
  "hsa_over_limit",
  "medical_deduction",
  "disaster_relief",
  "social_security_tax",
  "irmaa_watch",
  // Spec step 242: how a couple splits shared bills.
  "bill_split",
  "draft_return_check",
  // Spec step 241: goals that can't all be on time.
  "goal_tradeoffs",
  // Spec step 244: charges to confirm before last month can close.
  "month_close",
  // Phase AW: the practice portfolio's ideas, one topic per kind (src/config/practice-suggestions.ts).
  "practice_dip_buy",
  "practice_tax_loss_harvest",
  "practice_news_idea",
  "practice_new_money",
  "practice_cash_drag",
  "practice_cheaper_fund",
  "practice_payday_timing",
  "practice_drift_warning",
  "practice_glide_path",
  "practice_risk_mismatch",
  "practice_max_drop_near",
  "practice_theme_idea",
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
  // The question worth asking them first (step 257): the fact whose answer unlocks most, or
  // null when nothing left to ask is worth a question.
  firstQuestion: string | null; // Their answers to the investor profile's four questions (spec step 129), saved when their
  // demo bank is linked, as if they had answered them: Try Jane people get the portfolio
  // review, rebalance plan, goal buckets and retirement plan from the start.
  investor: {
    age: number;
    horizon: Horizon;
    dropReaction: DropReaction;
    goals: readonly Goal[];
  };
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
      "renters_insurance",
      "balance_transfer",
      "duplicate_subscription",
      "low_balance",
      "price_increase",
      "trial_conversion",

      "insurance_negotiation",
      "cover_change",
      "credit_building",
      "bnpl",
      "rent_reporting",
      "liability_levels",
      "consolidation",
      // Detector coverage: the lease renewed at $1,450, up from $1,320.
      "rent_increase",
      // Phase AW: the ideas their practice portfolio has waiting (people-extras/practice.ts).
      "practice_payday_timing",
      "practice_risk_mismatch",
    ],
    mustNot: [
      // Life facts (src/profile/life-facts.ts): cover for a pet and student plans only reach
      // someone with a pet or in school.
      "pet_insurance",
      "student_discounts",
      "beneficiaries",
      "values_funds",
      "umbrella",
      "long_term_care",
      "medigap",
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
      "old_accounts",
      "costly_products",
      "asset_location",
      "charity_receipts",
      "property_tax_check",
      "tax_loss_harvest",
      "s_corp_election",
      "home_office_deduction",
      "vehicle_deduction",
      "inherited_ira",
      "inherited_ira_spread",
      "plan_menu",
      "short_term_cash",
      "sudden_money",
      "household_setup",
      "life_checklist",
      "ptc_repayment",
      "hsa_over_limit",
      "medical_deduction",
      "social_security_tax",
      "irmaa_watch",
      "invested_cash",
    ],
    firstQuestion: "employer_match",
    // 24 with decades to go; a first home is the nearer goal.
    investor: { age: 24, horizon: "over_20", dropReaction: "worry", goals: ["retirement", "home"] },
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
      "beneficiaries",
      "rebalance",
      "pmi_removal",
      "life_insurance",
      "education_529",
      "subscriptions",
      "emergency_fund",
      "duplicate_subscription",
      "duplicate_charge",
      "car_addons",
      "budget_overrun",
      "insurance_shopping",
      "childcare_tax_break",
      "investment_fees",

      "insurance_claim",
      "student_forgiveness",
      "charity_receipts",
      "property_tax_check",
      "family_credit",
      "plan_menu",
      "life_checklist",
      "household_setup",
      // The family dog (vet visits and Chewy orders): cover only for someone who has a pet.
      "pet_insurance",

      "liability_levels",
      "disability_insurance",
      // Spec step 238: their joint savings is linked twice.
      "data_problems",
      "disaster_relief",
      "fsa_deadline",
      "deductible_met",
      "medical_bill_dispute",
      // Loans QA: their cash stays a 3-month cushion, so the 21.49% card is better as one
      // cheaper loan than paid from savings.
      "consolidation",
      // Phase AW: the ideas their practice portfolio has waiting (people-extras/practice.ts).
      "practice_dip_buy",
      "practice_tax_loss_harvest",
      "practice_new_money",
      "practice_cash_drag",
      "practice_drift_warning",
      "invested_cash",
    ],
    mustNot: [
      // Life facts (src/profile/life-facts.ts): cover for a pet and student plans only reach
      // someone with a pet or in school.
      "student_discounts",
      "values_funds",
      "renters_insurance",
      "medigap",
      "long_term_care",
      "refinance",
      "rmd",
      "medicare",
      "estimated_taxes",
      "hardship_plan",
      "social_security_timing",
      "roth_conversion",
      "backdoor_roth",
      "catch_up",
      "s_corp_election",
      "home_office_deduction",
      "vehicle_deduction",
      "inherited_ira",
      "inherited_ira_spread",
      "ptc_repayment",
      "social_security_tax",
      "irmaa_watch",
    ],
    firstQuestion: "employer_match",
    // Late 30s, two kids: retirement and their schooling.
    investor: {
      age: 38,
      horizon: "over_20",
      dropReaction: "worry",
      goals: ["retirement", "education"],
    },
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
      "student_repayment",
      "renters_insurance",
      "auto_insurance",
      "rent_reporting",
      "home_office_deduction",
      "vehicle_deduction",

      "disability_insurance",
      "ptc_repayment",
      "borrowing_power",
      // Spec step 244: WeWork and Adobe sit in a catch-all category.
      "month_close",
      // Spec step 201: client work needs general and professional liability.
      "business_insurance",
      // Phase AW: the ideas their practice portfolio has waiting (people-extras/practice.ts).
      "practice_news_idea",
      "practice_theme_idea",
    ],
    mustNot: [
      // Life facts (src/profile/life-facts.ts): cover for a pet and student plans only reach
      // someone with a pet or in school.
      "pet_insurance",
      "student_discounts",
      "beneficiaries",
      "values_funds",
      "employer_match",
      "rmd",
      "pmi_removal",
      "medicare",
      "hardship_plan",
      "roth_conversion",
      "childcare_tax_break",
      "old_accounts",
      "costly_products",
      "asset_location",
      "auto_invest",
      "property_tax_check",
      "tax_loss_harvest",
      "s_corp_election",
      "inherited_ira",
      "inherited_ira_spread",
      "plan_menu",
      "short_term_cash",
      "sudden_money",
      "household_setup",
      "life_checklist",
      "social_security_tax",
      "irmaa_watch",
      "invested_cash",
    ],
    firstQuestion: "filing_status",
    // Mid 30s, saving for retirement on their own (no employer plan).
    investor: { age: 34, horizon: "over_20", dropReaction: "fine", goals: ["retirement"] },
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
      "values_funds",
      "idle_cash",
      "concentration",
      "withholding_gap",
      "hsa",
      "backdoor_roth",
      "refinance",
      "mortgage_extra",
      "asset_location",
      "investment_fees",
      "auto_invest",

      "card_cover",
      "tax_loss_harvest",
      "charity_receipts",
      "property_tax_check",
      "plan_menu",
      "short_term_cash",
      "sudden_money",

      "deductible_fit",
      // Spec step 243: her fibre intro price ends and her storage plan renews.
      "promo_ending",
      "hsa_over_limit",
      // Spec step 266: about $1M she could be sued for, past what home cover's liability reaches.
      "umbrella",
      "practice_theme_idea",
      "invested_cash",
    ],
    mustNot: [
      // Life facts (src/profile/life-facts.ts): cover for a pet and student plans only reach
      // someone with a pet or in school.
      "pet_insurance",
      "student_discounts",
      "beneficiaries",
      "bank_fees",
      "late_fees",
      "hardship_plan",
      "medicare",
      "rmd",
      "credit_building",
      "student_repayment",
      "cash_advance",
      "roth_conversion",
      "childcare_tax_break",
      "s_corp_election",
      "home_office_deduction",
      "vehicle_deduction",
      "inherited_ira",
      "inherited_ira_spread",
      "household_setup",
      "life_checklist",
      "ptc_repayment",
    ],
    firstQuestion: "employer_match",
    // Early 40s, a big salary and stock: growing it, ready to buy a dip.
    investor: {
      age: 41,
      horizon: "10_to_20",
      dropReaction: "buy",
      goals: ["growth", "retirement"],
    },
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
      "beneficiaries",
      "social_security_timing",
      "medicare",
      "long_term_care",
      "catch_up",
      "idle_cash",
      "umbrella",
      "roth_conversion",
      "old_accounts",
      "investment_fees",
      "rebalance",

      "employer_benefits",
      "family_loans",
      "property_tax_check",
      "charity_receipts",
      "inherited_ira_spread",
      "plan_menu",
      "short_term_cash",
      "household_setup",
      "irmaa_watch",
      // Spec step 242: Dan earns about twice what Lena does.
      "bill_split",
      // Spec step 241: the trip to Japan and the kitchen can't both be on time.
      "goal_tradeoffs",
      // Detector coverage: they co-signed Emily's car loan.
      "cosign_risk",
      // Phase AW: the ideas their practice portfolio has waiting (people-extras/practice.ts).
      "practice_glide_path",
      "practice_theme_idea",
      "invested_cash",
    ],
    mustNot: [
      // Life facts (src/profile/life-facts.ts): cover for a pet and student plans only reach
      // someone with a pet or in school.
      "pet_insurance",
      "student_discounts",
      "values_funds",
      "education_529",
      "credit_building",
      "estimated_taxes",
      "hardship_plan",
      "employer_match",
      "low_balance",
      "student_repayment",
      "cash_advance",
      "trial_conversion",
      "childcare_tax_break",
      "s_corp_election",
      "home_office_deduction",
      "vehicle_deduction",
      "life_checklist",
      "ptc_repayment",
    ],
    firstQuestion: "employer_match",
    // 63, stopping work in a few years: retirement income soon, and Medicare's income line ahead.
    investor: {
      age: 63,
      horizon: "3_to_10",
      dropReaction: "worry",
      goals: ["retirement", "income"],
    },
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
    should: [
      "rmd",
      "medigap",
      "idle_cash",
      "subscriptions",
      "bill_negotiation",
      "costly_products",
      "investment_fees",
      "rebalance",
      "policy_documents",
      "property_tax_check",
      "charity_receipts",
      "medical_bills",
      "medical_deduction",
      "social_security_tax",
      "short_term_cash",
      // Detector coverage: her sister's IRA must be empty this December 31.
      "inherited_ira",
      // Phase AW: the ideas their practice portfolio has waiting (people-extras/practice.ts).
      "practice_dip_buy",
      "practice_tax_loss_harvest",
      "practice_cash_drag",
      "invested_cash",
    ],
    mustNot: [
      // Life facts (src/profile/life-facts.ts): cover for a pet and student plans only reach
      // someone with a pet or in school.
      "pet_insurance",
      "student_discounts",
      "beneficiaries",
      "values_funds",
      "renters_insurance",
      "health_insurance",
      // Umbrella came off this list (insurance QA pass): with their home counted, Ruth's net
      // worth is over the line the need calculator uses (about $857,000), so the page shows the
      // gap and the suggestion follows it.
      "employer_match",
      "education_529",
      "estimated_taxes",
      "catch_up",
      "hsa",
      "refinance",
      "credit_building",
      "low_balance",
      "student_repayment",
      "cash_advance",
      "car_addons",
      "trial_conversion",
      "childcare_tax_break",
      "auto_invest",

      "employer_benefits",
      "card_cover",
      "student_forgiveness",
      "credit_report_errors",
      "s_corp_election",
      "home_office_deduction",
      "vehicle_deduction",
      "inherited_ira_spread",
      "household_setup",
      "life_checklist",

      "disability_insurance",
      "ptc_repayment",
      "hsa_over_limit",
      "roth_conversion",
      "practice_portfolio",
    ],
    firstQuestion: null,
    // 71 and drawing from an IRA: income to live on, and a fall would be a worry.
    investor: { age: 71, horizon: "3_to_10", dropReaction: "worry", goals: ["income"] },
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
      "low_balance",
      "cash_advance",
      "credit_building",
      "credit_report_errors",
      "rent_reporting",
      // Phase AW: the ideas their practice portfolio has waiting (people-extras/practice.ts).
      "practice_max_drop_near",
      "practice_theme_idea",
    ],
    mustNot: [
      // Life facts (src/profile/life-facts.ts): cover for a pet and student plans only reach
      // someone with a pet or in school.
      "pet_insurance",
      "student_discounts",
      "beneficiaries",
      "values_funds",
      "concentration",
      "backdoor_roth",
      "hsa",
      "idle_cash",
      "refinance",
      "catch_up",
      "rmd",
      "umbrella",
      "insurance_shopping",
      // Spec step 260: extra money on a mortgage they don't have.
      "mortgage_extra",
      "roth_conversion",
      "childcare_tax_break",
      "old_accounts",
      "costly_products",
      "asset_location",
      "auto_invest",
      "rebalance",

      "card_cover",
      "charity_receipts",
      "property_tax_check",
      "tax_loss_harvest",
      "s_corp_election",
      "home_office_deduction",
      "vehicle_deduction",
      "inherited_ira",
      "inherited_ira_spread",
      "plan_menu",
      "short_term_cash",
      "sudden_money",
      "household_setup",
      "life_checklist",
      "ptc_repayment",
      "hsa_over_limit",
      "medical_deduction",
      "social_security_tax",
      "irmaa_watch",
      "practice_portfolio",
      // Spec step 250: a new loan is the wrong thing to bring someone in debt trouble.
      "borrowing_power",
      "invested_cash",
    ],
    firstQuestion: "hardship_reason",
    // Late 20s, stretched: a fall would scare them into selling.
    investor: { age: 27, horizon: "over_20", dropReaction: "sell", goals: ["retirement"] },
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
      "rent_reporting",
      "s_corp_election",
      "vehicle_deduction",
      "emergency_fund",

      "disability_insurance",
      // Spec step 239: her shop's sales are counted as her income.
      "figure_check",
      // Loans QA: her cash is kept as a 6-month cushion for uneven business income, so her
      // 23.49% card is better as one cheaper loan than paid from savings.
      "consolidation",
      // Phase AW: the ideas their practice portfolio has waiting (people-extras/practice.ts).
      "practice_news_idea",
      "practice_cheaper_fund",
    ],
    mustNot: [
      // Life facts (src/profile/life-facts.ts): cover for a pet and student plans only reach
      // someone with a pet or in school.
      "pet_insurance",
      "student_discounts",
      "beneficiaries",
      "values_funds",
      "employer_match",
      "rmd",
      "pmi_removal",
      "medicare",
      "hardship_plan",
      "roth_conversion",
      "childcare_tax_break",
      "old_accounts",
      "costly_products",
      "asset_location",
      "auto_invest",
      "property_tax_check",
      "tax_loss_harvest",
      "home_office_deduction",
      "inherited_ira",
      "inherited_ira_spread",
      "plan_menu",
      "short_term_cash",
      "sudden_money",
      "household_setup",
      "life_checklist",
      "invested_cash",
    ],
    firstQuestion: "business_structure",
    // Mid 40s, the shop's profits to grow for retirement 20 years off. With the shop's uneven
    // income that is the practice portfolio's level 4, as its demo bank runs it.
    investor: {
      age: 45,
      horizon: "over_20",
      dropReaction: "fine",
      goals: ["retirement", "growth"],
    },
  },
];

export const personById = (id: string): Person | undefined => PEOPLE.find((p) => p.id === id);
export const isPersonId = (id: string): id is PersonId =>
  (PERSON_IDS as readonly string[]).includes(id);
