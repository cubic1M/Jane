import type { PolicyKind } from "./insurance";

// Employer benefits (spec step 150): the cover that comes with the job, found from pay-stub
// deductions. Pay stubs come from a payroll source (src/lib/insurance/payroll.ts): a
// stand-in for demo-bank people until a payroll partner (Plaid Income, or a pay stub upload)
// is connected.
//
// What Jane does on its own, at every autopilot level: it reads the pay stubs, lists the
// benefits it finds (they count only once the person confirms each one), compares them with
// the same cover bought privately, and gets its recommendation ready before the employer's
// open enrollment. Enrolling is always the person's own step with their employer.

// Which deductions are which benefit, by their pay-stub label. The first match wins; any
// other deduction (taxes, retirement) is left alone.
export type BenefitKind = "health" | "dental" | "vision" | "life" | "disability" | "hsa" | "fsa";

export const BENEFIT_PATTERNS: readonly [BenefitKind, RegExp][] = [
  ["hsa", /\bhsa\b|health savings/i],
  ["fsa", /\bfsa\b|flex(?:ible)? spending/i],
  ["dental", /\bdental\b/i],
  ["vision", /\bvision\b/i],
  ["disability", /\b(?:ltd|std|disab\w*)\b/i],
  ["life", /\blife\b|\bad&d\b/i],
  ["health", /\b(?:medical|health|ppo|hmo|epo|hdhp)\b/i],
];

export const BENEFIT_LABELS: Record<BenefitKind, string> = {
  health: "Health insurance",
  dental: "Dental insurance",
  vision: "Vision insurance",
  life: "Life insurance",
  disability: "Disability insurance",
  hsa: "Health savings account (HSA)",
  fsa: "Flexible spending account (FSA)",
};

// The policy kind a confirmed benefit becomes on the insurance profile; HSA and FSA are
// accounts, not cover, and stay on the benefits list only.
export const BENEFIT_POLICY_KIND: Partial<Record<BenefitKind, PolicyKind>> = {
  health: "health",
  dental: "other",
  vision: "other",
  life: "life",
  disability: "disability",
};

// Pay periods a year, by the pay stub's frequency.
export const PAY_PERIODS = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 } as const;
export type PayFrequency = keyof typeof PAY_PERIODS;

// Cover through work that the pay stub doesn't show (the employer pays for it): life cover
// as a multiple of yearly pay, and long-term disability replacing this share of pay.
export const LIFE_MULTIPLES = { "1x": 1, "2x": 2 } as const;
export const DISABILITY_PAY_SHARE = 0.6;

// The employer's open enrollment: the heads-up with Jane's recommendation comes this many days
// before it ends.
export const ENROLLMENT_NOTICE_DAYS = 21;
// A private policy must be this much cheaper a year to be worth mentioning instead.
export const PRIVATE_CHEAPER_CENTS = 5_000;
// People whose pay stubs are read per daily run.
export const BENEFITS_DAILY_LIMIT = 200;
