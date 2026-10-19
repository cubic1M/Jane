// College savings (spec step 158): what college costs, how fast that grows, the 529 plans
// Jane compares (a stand-in until a 529 data partner is connected) and each state's tax
// break for saving in one. FOR REVIEW: the state figures change most years and should be
// checked before anyone relies on them; each is marked ESTIMATE TO VERIFY.

// A year of college today (tuition and fees, room and board), from the College Board's
// "Trends in College Pricing" (2024–25 averages, published prices before aid).
export const COLLEGE_COST_PER_YEAR_CENTS = {
  public: 2_492_000,
  private: 5_860_000,
} as const;
export type CollegeType = keyof typeof COLLEGE_COST_PER_YEAR_CENTS;
export const COLLEGE_TYPES: Readonly<Record<CollegeType, string>> = {
  public: "A public college in your state",
  private: "A private college",
};
export const COLLEGE_COST_SOURCE =
  "College Board, Trends in College Pricing (2024–25 average published prices, before aid)";

// How fast college prices rise a year: the range Jane projects with. Published prices rose
// faster than inflation for decades and closer to it lately (College Board).
export const COLLEGE_COST_GROWTH = { low: 0.03, high: 0.05 } as const;
export const COLLEGE_START_AGE = 18;
export const COLLEGE_YEARS = 4;
// Money for college is invested; the goal's glide path (step 157) makes it safer near the
// start date. These are the return assumptions for the monthly amount, as a range.
export const COLLEGE_RETURN = { low: 0.03, high: 0.06 } as const;

// The 529 plans Jane compares: made up (demo), to be replaced by a 529 data partner.
export type Plan529 = {
  key: string;
  name: string;
  // A year, in basis points of the balance.
  feeBps: number;
  // Only the home state's plan earns its tax break, unless the state allows any plan.
  homeState: boolean;
  note: string;
};
export const PLANS_529: readonly Plan529[] = [
  {
    key: "home",
    name: "Your state's direct 529 plan (demo)",
    feeBps: 15,
    homeState: true,
    note: "Index funds by age, bought directly",
  },
  {
    key: "national",
    name: "Keystone National 529 (demo)",
    feeBps: 10,
    homeState: false,
    note: "Low-cost index funds, open to anyone",
  },
  {
    key: "advisor",
    name: "Summit Advisor 529 (demo)",
    feeBps: 95,
    homeState: false,
    note: "Sold through an adviser, with a sales charge",
  },
];
export const PLANS_529_SOURCE = "Demo 529 plans (sample data, not real plans)";

// The state tax break for saving in a 529, a year: a deduction up to this much (per
// return; joint filers often double it), or a credit. anyPlan: the break works with any
// state's plan, not just the home state's. ESTIMATE TO VERIFY, from each state's 529 plan
// site; states not listed are treated as having none.
export const STATE_529: Readonly<
  Record<
    string,
    {
      deductionCents?: number;
      jointDeductionCents?: number;
      creditRate?: number;
      creditCapCents?: number;
      anyPlan?: boolean;
    }
  >
> = {
  NY: { deductionCents: 500_000, jointDeductionCents: 1_000_000 },
  IL: { deductionCents: 1_000_000, jointDeductionCents: 2_000_000 },
  MI: { deductionCents: 500_000, jointDeductionCents: 1_000_000 },
  VA: { deductionCents: 400_000, jointDeductionCents: 400_000 },
  GA: { deductionCents: 400_000, jointDeductionCents: 800_000 },
  OH: { deductionCents: 400_000, jointDeductionCents: 400_000 },
  MD: { deductionCents: 250_000, jointDeductionCents: 500_000 },
  MA: { deductionCents: 100_000, jointDeductionCents: 200_000 },
  NJ: { deductionCents: 1_000_000, jointDeductionCents: 1_000_000 },
  PA: { deductionCents: 1_900_000, jointDeductionCents: 3_800_000, anyPlan: true },
  AZ: { deductionCents: 200_000, jointDeductionCents: 400_000, anyPlan: true },
  MO: { deductionCents: 800_000, jointDeductionCents: 1_600_000, anyPlan: true },
  KS: { deductionCents: 300_000, jointDeductionCents: 600_000, anyPlan: true },
  IN: { creditRate: 0.2, creditCapCents: 150_000 },
};
export const STATE_529_SOURCE =
  "Each state's 529 plan site; ESTIMATE TO VERIFY before relying on it";
// Without the person's pay, the state rate is read at this taxable income.
export const STATE_RATE_DEFAULT_INCOME_CENTS = 8_000_000;
