// Insurance (spec Phase X, steps 102–108): every policy the person has, the household facts
// that matter for cover, and the gaps Jane points out. src/lib/insurance reads every limit
// and rule from here.
//
// What Jane does by herself, at every autopilot level (src/config/autopilot.ts): she keeps
// the profile up to date from documents (and, from step 99, from payments) and points out
// gaps. She never buys, changes or cancels cover without the person's own tap.

// The kinds of policy, as the profile and the forms name them.
export const POLICY_KINDS = {
  auto: "Car",
  home: "Home",
  renters: "Renters",
  life: "Life",
  pet: "Pet",
  health: "Health",
  // Spec step 149: every kind of cover.
  disability: "Disability",
  umbrella: "Umbrella",
  travel: "Travel",
  device: "Device protection",
  other: "Other",
} as const;

export type PolicyKind = keyof typeof POLICY_KINDS;

export const isPolicyKind = (value: unknown): value is PolicyKind =>
  typeof value === "string" && Object.hasOwn(POLICY_KINDS, value);

// Where a policy came from: typed by the person, read from an uploaded policy document
// (spec step 68), found from regular payments to an insurer (spec step 99), the demo
// bank's sample policy, or bound by Jane through the insurance partner (spec step 105).
export const POLICY_SOURCES = [
  "typed",
  "document",
  "payments",
  "demo",
  "switch",
  // Spec step 150: a benefit through work, confirmed from a pay stub or the guided flow.
  "employer",
] as const;
export type PolicySource = (typeof POLICY_SOURCES)[number];

export const POLICY_SOURCE_LABELS: Record<PolicySource, string> = {
  typed: "Added by you",
  document: "From your policy document",
  payments: "Found from your payments",
  demo: "Demo policy",
  switch: "Bound by Jane",
  employer: "Through your job",
};

// found: seen in payments, not confirmed yet (it doesn't count until it is). active: the
// person's cover. pending: bound through the partner, waiting for its first payment
// (spec step 105). cancelled: ended. removed: taken off the profile by the person (a
// document's policy is kept as removed, so the document doesn't add it back).
export const POLICY_STATUSES = ["found", "active", "pending", "cancelled", "removed"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

// A cover limit: money (cents), yes or no, a number of years, or a share in percent.
export type CoverageFieldType = "money" | "yesno" | "years" | "percent" | "days";
export type CoverageField = { key: string; label: string; type: CoverageFieldType };

// The cover limits that matter for each kind, in the order they're shown. Stored in
// insurance_policies.coverage by key; any that aren't known are left out.
export const COVERAGE_FIELDS: Record<PolicyKind, readonly CoverageField[]> = {
  auto: [
    { key: "bodilyInjuryPerPerson", label: "Injury liability, per person", type: "money" },
    { key: "bodilyInjuryPerAccident", label: "Injury liability, per accident", type: "money" },
    { key: "propertyDamage", label: "Property damage liability", type: "money" },
    { key: "collision", label: "Collision (damage to your car in a crash)", type: "yesno" },
    {
      key: "comprehensive",
      label: "Comprehensive (theft, weather, fire to your car)",
      type: "yesno",
    },
    { key: "uninsuredMotorist", label: "Uninsured driver cover", type: "yesno" },
  ],
  home: [
    { key: "dwelling", label: "The home itself", type: "money" },
    { key: "personalProperty", label: "Your belongings", type: "money" },
    { key: "liability", label: "Liability", type: "money" },
  ],
  renters: [
    { key: "personalProperty", label: "Your belongings", type: "money" },
    { key: "liability", label: "Liability", type: "money" },
  ],
  life: [
    { key: "deathBenefit", label: "Pays out", type: "money" },
    { key: "termYears", label: "Term", type: "years" },
  ],
  pet: [
    { key: "annualLimit", label: "Yearly limit", type: "money" },
    { key: "reimbursement", label: "Pays back", type: "percent" },
  ],
  health: [
    { key: "outOfPocketMax", label: "Most you pay in a year", type: "money" },
    { key: "coinsurance", label: "Your share after the deductible", type: "percent" },
  ],
  disability: [
    { key: "monthlyBenefit", label: "Pays a month", type: "money" },
    { key: "waitingDays", label: "Starts paying after", type: "days" },
    { key: "benefitYears", label: "Pays for up to", type: "years" },
  ],
  umbrella: [{ key: "liability", label: "Extra liability", type: "money" }],
  travel: [
    { key: "tripCost", label: "Trip cancellation, up to", type: "money" },
    { key: "medical", label: "Medical care abroad, up to", type: "money" },
  ],
  device: [{ key: "perClaimLimit", label: "Pays per claim, up to", type: "money" }],
  other: [],
};

// Limits on what can be typed, so a typo can't become a $10 billion policy.
export const MAX_PREMIUM_CENTS = 10_000_000;
export const MAX_DEDUCTIBLE_CENTS = 10_000_000;
export const MAX_LIMIT_CENTS = 10_000_000_000;
export const MAX_TERM_YEARS = 40;
// A disability policy's wait before it pays, in days.
export const MAX_WAITING_DAYS = 730;
export const MAX_CARRIER_LENGTH = 80;
export const MAX_COVERS_LENGTH = 160;
// Policies a person can keep on the profile.
export const MAX_POLICIES = 30;
// A policy's term, in months, when nothing says otherwise.
export const DEFAULT_TERM_MONTHS = 12;
export const TERM_MONTHS = [6, 12] as const;

// Household facts: housing, and how many cars, dependants and pets. Typed by the person;
// until they are, housing and cars are read from their accounts (a mortgage or a home
// they own means they own; rent payments in the last this-many days mean they rent; a car
// loan or a car they own means a car).
export const HOUSING = { own: "Own", rent: "Rent", other: "Neither" };
export type Housing = keyof typeof HOUSING;
export const RENT_LOOKBACK_DAYS = 90;
export const RENT_CATEGORY = "RENT_AND_UTILITIES_RENT";
export const MAX_HOUSEHOLD_COUNT = 20;

// Coverage gaps (spec step 102), each found by a rule in src/lib/insurance/gaps.ts.
export const GAP_KEYS = [
  "renters",
  "home",
  "auto",
  "life",
  "liability_only",
  // Spec step 149.
  "health",
  "disability",
  "umbrella",
  "pet",
  "travel",
] as const;
export type GapKey = (typeof GAP_KEYS)[number];

// "Renews soon": the profile and the chat say so this many days ahead.
export const RENEWAL_SOON_DAYS = 45;

// What to add for each gap: demo advice (spec step 98), shown only in demo advice mode
// with DEMO_ADVICE_LABEL. The dollar figures are listed so Claude's answers that repeat
// them pass the guardrails.
export const GAP_ADVICE: Record<GapKey, { text: string; cents: number[] }> = {
  renters: {
    text: "Add renters insurance with at least $30,000 for your belongings and $100,000 of liability cover. It often costs less than $20 a month.",
    cents: [3_000_000, 10_000_000, 2_000],
  },
  home: {
    text: "Add home insurance that pays to rebuild the whole home, with at least $300,000 of liability cover. Your lender likely requires it.",
    cents: [30_000_000],
  },
  auto: {
    text: "Add car insurance with liability limits of at least $100,000 per person, $300,000 per accident and $100,000 for property damage.",
    cents: [10_000_000, 30_000_000],
  },
  life: {
    text: "Add term life insurance worth about 10 times your yearly pay, for as long as people depend on you. Term cover costs far less than whole life.",
    cents: [],
  },
  liability_only: {
    text: "If replacing your car would cost more than you could pay from savings, add collision and comprehensive cover. If it's worth little, liability only can make sense.",
    cents: [],
  },
  health: {
    text: "Get a health plan: compare marketplace plans on what you'd pay in a year, premium plus your likely costs, not the premium alone. Open enrollment runs Nov 1 to Jan 15.",
    cents: [],
  },
  disability: {
    text: "Add long-term disability insurance that pays about 60 percent of your pay after a 90-day wait, until retirement age. Check your job's benefits first: many include it.",
    cents: [],
  },
  umbrella: {
    text: "Add a $1,000,000 umbrella policy. It usually costs a few hundred dollars a year, and your car and home policies need high enough liability limits under it.",
    cents: [100_000_000],
  },
  pet: {
    text: "If a vet bill of a few thousand dollars would be hard to pay, a pet policy that pays back 80 percent after a $250 deductible is a common middle choice.",
    cents: [25_000],
  },
  travel: {
    text: "Cover the trip's non-refundable cost and medical care abroad, but check your card's travel benefits first: some already cover cancellation.",
    cents: [],
  },
};

// Gap rules for the kinds added in spec step 149, read from the accounts.
// An umbrella policy matters once what someone has is worth protecting from a lawsuit.
export const UMBRELLA_ASSETS_CENTS = 50_000_000;
// A paycheck in this many days means the person earns, so losing it to illness matters.
export const INCOME_LOOKBACK_DAYS = 45;
export const INCOME_CATEGORY = "INCOME_SALARY";
// Recent trips worth insuring: this much spent on flights and hotels in this many days.
export const TRAVEL_GAP_MIN_CENTS = 100_000;
export const TRAVEL_LOOKBACK_DAYS = 60;
// Medical spending over this many days stands for what someone usually spends on care.
export const MEDICAL_LOOKBACK_DAYS = 365;

// --- Quotes (spec step 103) --------------------------------------------------------------
// Quotes come from an insurance partner (src/lib/insurance/partner.ts). Until a licensed
// partner is connected, a stand-in carrier catalog (src/data-sources/demo/demo-carriers.ts)
// prices policies for demo-bank people with the fixed rules below. Real accounts get no
// quotes. At every autopilot level Jane may ask for quotes by herself: they cost nothing and
// commit to nothing. Buying (binding) always needs the person's tap.

// Which partner answers: "demo" (the stand-in, for demo-bank people only) until a real one
// is connected. A real partner needs a licensed agency agreement and counsel's sign-off
// (COUNSEL_INSURANCE_REFERRALS in src/config/referrals.ts).
export const INSURANCE_PARTNER_ENV = "INSURANCE_PARTNER";

// A quote is good for this many days.
export const QUOTE_VALID_DAYS = 30;
// Kinds the partner quotes. Health insurance goes through the marketplace, not a carrier.
export const QUOTABLE_KINDS: readonly PolicyKind[] = [
  "auto",
  "home",
  "renters",
  "life",
  "pet",
  // Spec step 149.
  "health",
  "disability",
  "umbrella",
  "travel",
  "device",
];

// The stand-in's pricing, a year, in cents, before the carrier's own factor. Fixed rules
// from the person's profile: what's insured, the cover and deductible asked for, and their
// state. Made-up numbers in a realistic range; never a real carrier's rates.
export const DEMO_PRICING = {
  auto: {
    perVehicle: 110_000,
    // By injury liability per person: at least this much → this factor.
    liabilityLevels: [
      { atLeastCents: 10_000_000, factor: 1.15 },
      { atLeastCents: 5_000_000, factor: 1 },
      { atLeastCents: 0, factor: 0.9 },
    ],
    collision: 0.4,
    comprehensive: 0.15,
    uninsuredMotorist: 0.05,
    // Defaults when the policy doesn't say.
    defaults: {
      bodilyInjuryPerPerson: 5_000_000,
      bodilyInjuryPerAccident: 10_000_000,
      propertyDamage: 5_000_000,
      collision: true,
      comprehensive: true,
      uninsuredMotorist: true,
    },
  },
  home: {
    // A share of the home's rebuild value, in basis points.
    dwellingBps: 35,
    highLiabilityCents: 30_000_000,
    highLiabilityFactor: 1.05,
    defaults: { dwelling: 30_000_000, personalProperty: 15_000_000, liability: 30_000_000 },
  },
  renters: {
    base: 9_000,
    personalPropertyBps: 20,
    highLiabilityCents: 30_000_000,
    highLiabilityFactor: 1.1,
    defaults: { personalProperty: 3_000_000, liability: 10_000_000 },
  },
  life: {
    // Per $1,000 of cover, a year, for a 20-year term.
    perThousandCents: 35,
    termFactors: { 10: 0.7, 15: 0.85, 20: 1, 25: 1.25, 30: 1.6 } as Record<number, number>,
    defaults: { deathBenefit: 50_000_000, termYears: 20 },
  },
  pet: {
    perPet: 40_000,
    reimbursementFactors: { 70: 0.85, 80: 1, 90: 1.2 } as Record<number, number>,
    defaults: { annualLimit: 1_000_000, reimbursement: 80 },
  },
  // Spec step 149. Disability: a year's price per $100 of monthly benefit, cheaper with a
  // longer wait.
  disability: {
    perHundredMonthlyCents: 2_400,
    waitingFactors: { 30: 1.3, 60: 1.1, 90: 1, 180: 0.85 } as Record<number, number>,
    defaults: { monthlyBenefit: 300_000, waitingDays: 90, benefitYears: 30 },
  },
  // Umbrella: a year per $1,000,000 of extra liability.
  umbrella: { perMillionCents: 30_000, defaults: { liability: 100_000_000 } },
  // Travel: a share of the trip's cost, in basis points.
  travel: { tripCostBps: 600, defaults: { tripCost: 300_000, medical: 5_000_000 } },
  // Device protection: a year per device.
  device: { perDeviceCents: 12_000, defaults: { perClaimLimit: 150_000 } },
  // A higher deductible lowers the price (cents → factor); the nearest one counts.
  deductibleFactors: [
    { cents: 25_000, factor: 1.1 },
    { cents: 50_000, factor: 1 },
    { cents: 100_000, factor: 0.9 },
    { cents: 250_000, factor: 0.8 },
  ],
  defaultDeductibleCents: 50_000,
  // States where cover costs more (two-letter code → factor); the rest are 1.
  stateFactors: { MI: 1.6, FL: 1.4, LA: 1.4, NY: 1.25, CA: 1.15, TX: 1.1 } as Record<
    string,
    number
  >,
} as const;

// --- Shopped for you (spec step 104) ------------------------------------------------------
// Jane reshops every policy by herself, at every autopilot level: this many days before it
// renews, and whenever its price goes up. She picks the lowest price for the same cover,
// weighted by the carrier's rating, and asks once. Nothing is bought without a tap.
export const RESHOP_DAYS_BEFORE_RENEWAL = 45;
// A carrier's price counts this much more for each rating point below 100 (0.5% a point),
// so a much better-rated carrier can win at a slightly higher price.
export const PICK_RATING_PENALTY_PER_POINT = 0.005;
// Carriers rated below this score are never the pick.
export const PICK_MIN_RATING_SCORE = 85;
// The pick must save at least this much a year to be worth asking about.
export const RESHOP_MIN_SAVING_CENTS = 5_000;
// Options shown besides the pick.
export const RESHOP_RUNNERS_UP = 2;
// A charge from the insurer this much above the policy's price counts as a price rise,
// looked for in the last this-many days.
export const PRICE_UP_TOLERANCE_CENTS = 100;
export const PRICE_UP_LOOKBACK_DAYS = 45;
// People reshopped per daily run, the longest-waiting first.
export const RESHOP_DAILY_LIMIT = 200;
// "I checked: nothing better" is said for reshops from the last this-many days.
export const RESHOP_NEWS_DAYS = 7;

// --- One-tap switch (spec step 105) --------------------------------------------------------
// After the Yes, Jane does the rest by herself, at every autopilot level: she binds the pick
// through the insurance partner to start the day the current policy renews (or tomorrow),
// waits for its first payment, and only then cancels the old policy, from the same day, so
// there's never a gap in cover. She stores the new policy's documents on /documents.
// If the first payment hasn't gone through this many days after the start, the team takes
// over (the old policy is still in place).
export const SWITCH_PAYMENT_DAYS = 10;
// Switches finished in the last this-many days are said in the chat.
export const SWITCH_NEWS_DAYS = 7;

// --- Coverage checkup (spec step 106) -------------------------------------------------------
// Demo advice only (spec step 98). Jane runs it by herself once a year and after a life event
// (spec step 100), at every autopilot level; changing cover always needs the person's tap.
// Each recommendation shows what it costs (or saves) a year, from DEMO_PRICING's fixed
// rules, and the risk it changes.
export const CHECKUP_EVERY_DAYS = 365;
// A higher deductible is worth it when savings cover it this many times over; a deductible
// savings can't cover once is too high.
export const DEDUCTIBLE_SAVINGS_MULTIPLE = 3;
// Car injury liability below this per person is low for someone with something to protect.
export const LIABILITY_TARGET_CENTS = 10_000_000;
export const LIABILITY_TARGET_ACCIDENT_CENTS = 30_000_000;
// Full cover on a car worth less than this rarely pays: repairs would soon cost more than
// the car.
export const FULL_COVER_MIN_CAR_VALUE_CENTS = 400_000;
// Home cover below this share of the home's value may not rebuild it; above the upper share,
// it may insure more than there is to rebuild.
export const HOME_UNDER_INSURED_SHARE = 0.8;
export const HOME_OVER_INSURED_SHARE = 1.5;
// Carriers usually take this share off when car and home (or renters) are with them both.
export const BUNDLE_DISCOUNT_SHARE = 0.1;
// Term life worth this many years of pay, after a new baby with no life cover.
export const LIFE_COVER_YEARS_OF_PAY = 10;
export const LIFE_COVER_DEFAULT_CENTS = 50_000_000;
// People checked per daily run.
export const CHECKUP_DAILY_LIMIT = 200;

// --- Insurance on autopilot (spec step 108) ------------------------------------------------
// What Jane does with insurance by herself at each autopilot level (src/config/autopilot.ts).
// Insurance is never approved by a standing rule (NEVER_BY_RULE): buying, changing or
// cancelling cover always takes the person's own tap.
export const INSURANCE_AUTOPILOT: Record<"ask" | "safe" | "all" | "custom" | "none", string> = {
  none: "I watch every renewal and price rise, reshop each policy 45 days before it renews, check your cover once a year and after a life event, and remind you of claim steps. I read every policy document you upload and ask you to confirm it. I ask you before buying anything.",
  ask: "I watch every renewal and price rise, reshop each policy 45 days before it renews, check your cover once a year and after a life event, and remind you of claim steps. I read every policy document you upload and ask you to confirm it. I ask you before buying anything.",
  safe: "I watch every renewal and price rise, reshop each policy 45 days before it renews, check your cover once a year and after a life event, and remind you of claim steps. I read every policy document you upload and ask you to confirm it. I ask you before buying anything.",
  custom:
    "I watch every renewal and price rise, reshop each policy 45 days before it renews, check your cover once a year and after a life event, and remind you of claim steps. I read every policy document you upload and ask you to confirm it. I ask you before buying anything.",
  all: "I watch every renewal and price rise, reshop each policy 45 days before it renews, and keep the best switch ready so it's one tap: I refresh its quotes before they expire. I also check your cover once a year, read every policy document you upload and remind you of claim steps. What I read and buying still take your tap.",
};
// At "handle everything", a ready pick's quotes are refreshed this many days before they
// expire, so the one tap always works.
export const PICK_REFRESH_DAYS = 5;

// --- Health plans (spec step 149) ----------------------------------------------------------
// Marketplace plans are compared on what they'd cost in a year: the premium plus what the
// person would likely pay for care under the plan (expected out of pocket), from their own
// medical spending over MEDICAL_LOOKBACK_DAYS, or this much when there's none.
export const HEALTH_DEFAULT_SPEND_CENTS = 150_000;
// Open enrollment for marketplace plans (month-day), said as a deadline to people with a
// marketplace plan or no health cover.
export const OPEN_ENROLLMENT = { start: "11-01", end: "01-15" } as const;
// Each extra person on a health plan costs this share of the first person's premium.
export const HEALTH_EXTRA_PERSON_SHARE = 0.8;

// --- Policies read from documents (spec step 151) ---------------------------------------------
// What Jane reads off a declarations page or renewal notice is checked by these rules before
// it's shown for the person to confirm: a renewal date this far either side of today, and a
// price this far from what their payments show is pointed out.
export const READING_RENEWAL_WINDOW_DAYS = { past: 366, future: 800 } as const;
export const READING_PRICE_TOLERANCE = 0.2;

// --- Life insurance, sized and bought (spec step 153) ------------------------------------------
// Demo advice only. The need: years of pay replaced for the people who depend on it, plus
// debts, final expenses and schooling per dependant, less savings and cover already in
// place; rounded up, within these bounds.
export const LIFE_NEED = {
  incomeYears: 10,
  finalExpensesCents: 1_500_000,
  educationPerDependantCents: 5_000_000,
  roundToCents: 5_000_000,
  minCents: 10_000_000,
  maxCents: 500_000_000,
} as const;
// The term: long enough to see the mortgage paid off and dependants grown, at least this.
export const LIFE_MIN_TERM_YEARS = 20;
export const LIFE_TERMS = [10, 15, 20, 25, 30] as const;
// Pay is read from the paychecks in this many days, times a year.
export const LIFE_PAY_LOOKBACK_DAYS = 90;
// People sized per daily run.
export const LIFE_DAILY_LIMIT = 200;
// The guided health questions for an application, asked one at a time. A yes to any of
// the first four sends it for the carrier's review instead of an instant decision; tobacco
// is priced in.
export const LIFE_HEALTH_QUESTIONS = [
  {
    key: "conditions",
    text: "Have you ever been treated for heart disease, cancer, a stroke or diabetes?",
  },
  {
    key: "hospital",
    text: "Have you stayed in a hospital overnight in the last 5 years, other than for giving birth?",
  },
  { key: "medication", text: "Do you take any prescription medicine every day?" },
  { key: "driving", text: "Have you had a DUI or your license suspended in the last 5 years?" },
  { key: "tobacco", text: "Have you used tobacco or nicotine in the last 12 months?" },
] as const;
export type LifeQuestionKey = (typeof LIFE_HEALTH_QUESTIONS)[number]["key"];
// The stand-in's price for a tobacco user, and for someone on daily medication, as a
// multiple of the quote.
export const LIFE_TOBACCO_FACTOR = 2.5;
export const LIFE_STANDARD_FACTOR = 1.3;
// How long a stand-in life application's offer stays open.
export const LIFE_OFFER_DAYS = 30;
