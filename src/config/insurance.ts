// Insurance (spec Phase X, steps 102–108): every policy the person has, the household facts
// that matter for cover, and the gaps Jane points out. src/lib/insurance reads every limit
// and rule from here.
//
// What Jane does on its own, at every autopilot level (src/config/autopilot.ts): it keeps
// the profile up to date from documents (and, from step 99, from payments) and points out
// gaps. It never buys, changes or cancels cover without the person's own tap.

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
  // Spec step 197: cover for how they live.
  rideshare: "Rideshare",
  business: "Business",
  valuables: "Valuables",
  boat: "Boat",
  rental_property: "Rental property",
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
  rideshare: [
    { key: "liability", label: "Liability while you drive for pay", type: "money" },
    { key: "collision", label: "Damage to your car while you drive for pay", type: "yesno" },
  ],
  business: [
    { key: "generalLiability", label: "General liability", type: "money" },
    { key: "professionalLiability", label: "Professional liability", type: "money" },
    { key: "businessProperty", label: "Business equipment and stock", type: "money" },
  ],
  valuables: [{ key: "listedValue", label: "Value of the items listed", type: "money" }],
  boat: [
    { key: "hullValue", label: "Boat value covered", type: "money" },
    { key: "liability", label: "Liability", type: "money" },
  ],
  rental_property: [
    { key: "dwelling", label: "Home rebuild cost", type: "money" },
    { key: "liability", label: "Liability while renting it out", type: "money" },
    { key: "lossOfRent", label: "Lost rent after damage", type: "yesno" },
  ],
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
  // Spec step 197: risks seen in how they live, after they said yes.
  "rideshare",
  "home_business",
  "valuables",
  "boat",
  "short_term_rental",
  // Spec step 198: per person in the household.
  "teen_driver",
  "spouse_health",
  "family_health_plan",
  // Spec step 201: cover for what they earn on the side.
  "business_liability",
  "professional_liability",
  "car_business_use",
  "business_equipment",
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
  rideshare: {
    text: "Ask for a rideshare endorsement, or a policy that covers you while you drive for pay, so your own car policy isn't the only thing between you and a claim. It usually adds a few hundred dollars a year.",
    cents: [],
  },
  business_liability: {
    text: "Add general liability insurance with at least $1,000,000 of cover. It pays if a customer or client is hurt or their property is damaged by your work, which a home or renters policy won't.",
    cents: [100_000_000],
  },
  professional_liability: {
    text: "Add professional liability (errors and omissions) cover. It pays if a client says your advice or work cost them money, which general liability and personal policies don't.",
    cents: [],
  },
  car_business_use: {
    text: "Ask your car insurer to add business use, or take a policy that covers driving for work. Personal policies cover commuting and personal trips, not work driving.",
    cents: [],
  },
  business_equipment: {
    text: "Add business property cover for your equipment. A home or renters policy usually caps work equipment at a small limit, or excludes it when it's used for business.",
    cents: [],
  },
  home_business: {
    text: "Add business insurance: general liability with at least $1,000,000 of cover, and cover for your equipment and stock. A home policy pays little for a business.",
    cents: [100_000_000],
  },
  valuables: {
    text: "List the ring or camera on your policy by name. Listed items are paid at their full value, while unlisted ones are usually capped at a small limit.",
    cents: [],
  },
  boat: {
    text: "Add boat insurance that pays for the boat itself and for damage you cause to others on the water. Your home policy usually caps or excludes boats.",
    cents: [],
  },
  teen_driver: {
    text: "Add the new driver to your car policy before they drive. Carriers price a teen driver in, and an unlisted one can leave a claim disputed. Good-student and driver-training discounts are common.",
    cents: [],
  },
  spouse_health: {
    text: "Add your spouse to a health plan: yours, or their employer's if it has one. Open enrollment and a recent life event are the usual times to switch.",
    cents: [],
  },
  family_health_plan: {
    text: "Compare the two plans for the whole family, with the care you usually need, and move to the cheaper one at the next open enrollment or after a life event.",
    cents: [],
  },
  short_term_rental: {
    text: "Switch to a policy written for renting a home out, with liability for guests and lost rent after damage. A regular home policy often excludes paying guests.",
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
// quotes. At every autopilot level Jane may ask for quotes on its own: they cost nothing and
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
  "rideshare",
  "business",
  "valuables",
  "boat",
  "rental_property",
];

// The stand-in's pricing, a year, in cents, before the carrier's own factor. Fixed rules
// from the person's profile: what's insured, the cover and deductible asked for, and their
// state. Made-up numbers in a realistic range; never a real carrier's rates.
export const DEMO_PRICING = {
  auto: {
    perVehicle: 110_000,
    // By injury liability per person: at least this much → this factor.
    liabilityLevels: [
      { atLeastCents: 25_000_000, factor: 1.3 },
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
  // Spec step 197. Rideshare: a year on top of a car policy. Business: a base and a share
  // of the equipment. Valuables: a share of the listed value. Boat: a base and a share of
  // the hull value. Rental property: a share of the rebuild cost.
  rideshare: { perYearCents: 36_000, defaults: { liability: 10_000_000 } },
  business: {
    // A year for $1,000,000 of general liability, scaled by the level (spec step 201), plus a
    // share of the property covered, plus professional liability per $1,000,000.
    baseCents: 42_000,
    propertyBps: 150,
    liabilityLevels: [
      { atLeastCents: 200_000_000, factor: 1.3 },
      { atLeastCents: 100_000_000, factor: 1 },
      { atLeastCents: 0, factor: 0.8 },
    ],
    professionalPerMillionCents: 60_000,
    defaults: {
      generalLiability: 100_000_000,
      businessProperty: 1_000_000,
      professionalLiability: 0,
    },
  },
  valuables: { listedBps: 110, defaults: { listedValue: 500_000 } },
  boat: {
    baseCents: 18_000,
    hullBps: 160,
    defaults: { hullValue: 2_000_000, liability: 30_000_000 },
  },
  rental_property: { dwellingBps: 70, defaults: { dwelling: 40_000_000, liability: 30_000_000 } },
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
// Jane reshops every policy on its own, at every autopilot level: this many days before it
// renews, and whenever its price goes up. It picks the lowest price for the same cover,
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
// After the Yes, Jane does the rest on its own, at every autopilot level: it binds the pick
// through the insurance partner to start the day the current policy renews (or tomorrow),
// waits for its first payment, and only then cancels the old policy, from the same day, so
// there's never a gap in cover. It stores the new policy's documents on /documents.
// If the first payment hasn't gone through this many days after the start, the team takes
// over (the old policy is still in place).
export const SWITCH_PAYMENT_DAYS = 10;
// Switches finished in the last this-many days are said in the chat.
export const SWITCH_NEWS_DAYS = 7;

// --- Coverage checkup (spec step 106) -------------------------------------------------------
// Demo advice only (spec step 98). Jane runs it on its own once a year and after a life event
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
// What Jane does with insurance on its own at each autopilot level (src/config/autopilot.ts).
// Insurance is never approved by a standing rule (NEVER_BY_RULE): buying, changing or
// cancelling cover always takes the person's own tap.
// What Jane keeps up with insurance at each step 57 level. Whether it buys or switches by
// itself is the Insurance area's own setting (spec step 141), said after this by byHerself
// (src/lib/jane-agent/replies-autopilot.ts).
export const INSURANCE_AUTOPILOT: Record<"ask" | "safe" | "all" | "custom" | "none", string> = {
  none: "I watch every renewal and price rise, reshop each policy 45 days before it renews, check your cover once a year and after a life event, and remind you of claim steps. I read every policy document you upload and ask you to confirm it, and I ask before calling an insurer about a renewal that's going up. I file small claims for you once you've checked them.",
  ask: "I watch every renewal and price rise, reshop each policy 45 days before it renews, check your cover once a year and after a life event, and remind you of claim steps. I read every policy document you upload and ask you to confirm it, and I ask before calling an insurer about a renewal that's going up. I file small claims for you once you've checked them.",
  safe: "I watch every renewal and price rise, reshop each policy 45 days before it renews, check your cover once a year and after a life event, and remind you of claim steps. I read every policy document you upload and ask you to confirm it, and I ask before calling an insurer about a renewal that's going up. I file small claims for you once you've checked them.",
  custom:
    "I watch every renewal and price rise, reshop each policy 45 days before it renews, check your cover once a year and after a life event, and remind you of claim steps. I read every policy document you upload and ask you to confirm it, and I ask before calling an insurer about a renewal that's going up. I file small claims for you once you've checked them.",
  all: "I watch every renewal and price rise, reshop each policy 45 days before it renews, and keep the best switch ready so it's one tap: I refresh its quotes before they expire. I also check your cover once a year, read every policy document you upload, remind you of claim steps, and call your insurer for a better rate before a renewal that's going up, within your limits. What I read and filing a claim still take your tap.",
};
// At "handle everything", a ready pick's quotes are refreshed this many days before they
// expire, so the one tap always works.
export const PICK_REFRESH_DAYS = 5;
// Spec step 202: what "Keep me covered" may do. These leave the cover exactly as it is. A
// higher deductible lowers it, and a safe-driver program shares driving data, so both always
// wait for the person's own tap.
export const KEEP_COVERED_SAVING_KINDS: readonly SavingKind[] = [
  "pay_in_full",
  "autopay",
  "paperless",
  "bundle",
];

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

// --- Cover changes with life events (spec step 154) ----------------------------------------
// Events this recent get their cover changes prepared.
export const COVER_EVENT_WINDOW_DAYS = 60;
export const COVER_EVENTS = ["car_bought", "moving", "new_baby", "married", "new_job"] as const;
export type CoverEvent = (typeof COVER_EVENTS)[number];
export const COVER_CHANGES = [
  "address",
  "add_vehicle",
  "add_spouse",
  "add_dependant",
  "review_life",
  "review_benefits",
  "get_auto",
] as const;
export type CoverChangeKind = (typeof COVER_CHANGES)[number];
// Changes that never change the price: at "handle everything" Jane makes them itself.
export const NO_PRICE_CHANGES: readonly CoverChangeKind[] = ["address"];
// Changes made with the carrier through the partner; the rest are reviews and links.
export const CARRIER_CHANGES: readonly CoverChangeKind[] = [
  "address",
  "add_vehicle",
  "add_spouse",
  "add_dependant",
];
// The stand-in carrier's new price after a change, as a multiple of the old.
export const DEMO_ENDORSEMENT_FACTORS: Record<string, number> = {
  add_vehicle: 1.8,
  add_spouse: 1.3,
  add_dependant: 1.25,
  address: 1,
};
export const COVER_CHANGES_DAILY_LIMIT = 200;

// --- Renewal negotiation and claims, done by Jane (spec step 155) ---------------------------
// A renewal this much (share) above today's price is worth asking the carrier about.
export const NEGOTIATE_MIN_RISE = 0.05;
// How far back a policy's charges are read to see what it cost before a rise (a year: monthly
// and six-monthly premiums both show their old price).
export const NEGOTIATE_HISTORY_DAYS = 365;
// The stand-in carrier meets a cheaper competing quote this close (share above it), or
// takes off this share of the rise for a loyal customer, never below today's price.
export const DEMO_NEGOTIATE = { matchMargin: 0.02, loyaltyShareOfRise: 0.5 } as const;
// Jane files claims up to this amount itself through the partner; bigger ones stay with
// the person and the claims helper.
export const SMALL_CLAIM_MAX_CENTS = 250_000;
// The stand-in carrier's claim, day by day after filing: received, then reviewing, then
// approved (paying the claim less the deductible), then paid.
export const DEMO_CLAIM_DAYS = { reviewing: 2, approved: 5, paid: 10 } as const;
export const NEGOTIATIONS_DAILY_LIMIT = 200;
export const CLAIMS_DAILY_LIMIT = 200;

// --- Paying less for the same cover (spec step 196) -----------------------------------------
// Rates are estimates from typical carrier programs, said as "about". Every one is shown with
// what changes; none drops cover unless it says so (a higher deductible).
export const SAVING_KINDS = [
  "pay_in_full",
  "autopay",
  "paperless",
  "bundle",
  "telematics",
  "higher_deductible",
] as const;
export type SavingKind = (typeof SAVING_KINDS)[number];

export const SAVING_RATES = {
  // Paying a year up front: the installment fee on each payment, and the carrier's discount.
  payInFull: { installmentFeeCents: 400, discountShare: 0.05 },
  autopay: { discountShare: 0.03 },
  paperless: { discountShare: 0.02 },
  // One carrier for car and home (or renters): off both.
  bundle: { discountShare: BUNDLE_DISCOUNT_SHARE },
  // A usage-based safe-driver program on a car policy.
  telematics: { discountShare: 0.1 },
  // Each step up the ladder is worth this much of the premium.
  deductibleStepShare: 0.1,
} as const;
// Deductibles a carrier offers, per kind; a higher one is suggested only when the person's
// savings cover it this many times over.
export const DEDUCTIBLE_LADDERS: Partial<Record<PolicyKind, readonly number[]>> = {
  auto: [25_000, 50_000, 100_000, 200_000],
  home: [100_000, 250_000, 500_000, 1_000_000],
  renters: [25_000, 50_000, 100_000, 250_000],
};
export const DEDUCTIBLE_SAVINGS_COVER = 2;
// Kinds with a premium that these apply to; a saving under this is not worth a message.
export const MIN_SAVING_CENTS = 2_000;
// Kinds that carry monthly installment fees and discounts like these.
export const SAVING_POLICY_KINDS: readonly PolicyKind[] = ["auto", "home", "renters"];

// --- Risks seen in how they live (spec step 197) -----------------------------------------------
// Signals in the person's transactions that a policy they have may not cover something. Each
// is a rule: a merchant pattern, which way the money goes, how recent, and (for purchases)
// how big. Each becomes one question in the chat, asked once; a no is remembered for good.
export const RISK_KINDS = [
  "rideshare",
  "home_business",
  "new_dog",
  "valuable",
  "boat",
  "rental_out",
] as const;
export type RiskKind = (typeof RISK_KINDS)[number];

export const RISK_SIGNALS: Record<
  RiskKind,
  {
    // "in" is money coming in (a payout), "out" is spending.
    direction: "in" | "out";
    pattern: RegExp;
    // Only charges this big count (a ring, not a ring cleaner).
    minCents: number;
    // The gap a yes opens, and the policy kind that closes it; null when a yes updates the
    // household instead (a new dog adds a pet).
    gap: { key: GapKey; kind: PolicyKind } | null;
  }
> = {
  rideshare: {
    direction: "in",
    pattern:
      /\b(?:uber|lyft)\b.*\b(?:driver|payout|earnings)\b|\b(?:doordash|dasher|grubhub|instacart|shipt)\b.*\b(?:payout|earnings|deposit)\b|\buber eats\b.*\bpayout\b/i,
    minCents: 0,
    gap: { key: "rideshare", kind: "rideshare" },
  },
  home_business: {
    direction: "in",
    pattern:
      /\b(?:shopify|square|stripe|etsy|gumroad|squarespace)\b.*\b(?:payout|transfer|deposit)\b/i,
    minCents: 0,
    gap: { key: "home_business", kind: "business" },
  },
  new_dog: {
    direction: "out",
    pattern:
      /\b(?:vca|banfield|animal hospital|animal clinic|veterinar\w*|vet clinic|petco|petsmart|chewy)\b/i,
    minCents: 0,
    gap: null,
  },
  valuable: {
    direction: "out",
    pattern:
      /\b(?:zales|kay jewelers|jared|tiffany|blue nile|brilliant earth|b&h|bhphoto|adorama)\b/i,
    minCents: 150_000,
    gap: { key: "valuables", kind: "valuables" },
  },
  boat: {
    direction: "out",
    pattern: /\b(?:west marine|boatus|marina|boat (?:dealer|sales|storage))\b/i,
    minCents: 0,
    gap: { key: "boat", kind: "boat" },
  },
  rental_out: {
    direction: "in",
    pattern: /\b(?:airbnb|vrbo|homeaway)\b/i,
    minCents: 0,
    gap: { key: "short_term_rental", kind: "rental_property" },
  },
};
// How far back a signal counts; a new dog needs no vet or pet-store charge before this
// many days ago, so a long-time pet owner isn't asked.
export const RISK_LOOKBACK_DAYS = 60;
export const RISK_NEW_PET_QUIET_DAYS = 120;

// --- The whole household's cover (spec step 198) ---------------------------------------------
export const HOUSEHOLD_RELATIONS = {
  spouse: "Spouse or partner",
  child: "Child",
  other: "Someone else",
} as const;
export type HouseholdRelation = keyof typeof HOUSEHOLD_RELATIONS;
export const isHouseholdRelation = (value: unknown): value is HouseholdRelation =>
  typeof value === "string" && Object.hasOwn(HOUSEHOLD_RELATIONS, value);
// A driver this age or younger is a teen driver, who needs to be on a car policy.
export const TEEN_DRIVER_MAX_AGE = 19;
export const MAX_HOUSEHOLD_PEOPLE = 10;
export const MAX_PERSON_NAME_LENGTH = 40;
// A family health plan has to cost this much less a year, with the care the household
// usually needs, before Jane says to look at the other employer's plan.
export const FAMILY_HEALTH_MIN_SAVING_CENTS = 60_000;

// --- Claim or pay yourself? (spec step 199) ---------------------------------------------------
// What a claim typically costs in higher premiums: a share of the yearly premium added for
// CLAIM_SURCHARGE_YEARS years, by kind of policy and what happened (the claim guide's event
// key), and the claims-free discount lost for the same years. Estimates from typical carrier
// practice, said as "about"; never a promise of what a carrier will do.
export const CLAIM_SURCHARGE_YEARS = 3;
export const CLAIM_SURCHARGE: Record<
  PolicyKind,
  { default: number; events?: Record<string, number> }
> = {
  auto: { default: 0.1, events: { accident: 0.3, theft: 0.08, damage: 0.05 } },
  home: { default: 0.12, events: { break_in: 0.1, damage: 0.18, theft: 0.1 } },
  renters: { default: 0.06 },
  life: { default: 0 },
  pet: { default: 0.05 },
  health: { default: 0 },
  disability: { default: 0 },
  umbrella: { default: 0.1 },
  travel: { default: 0 },
  device: { default: 0 },
  rideshare: { default: 0.15, events: { accident: 0.3 } },
  business: { default: 0.12 },
  valuables: { default: 0.05 },
  boat: { default: 0.12, events: { theft: 0.1 } },
  rental_property: { default: 0.15 },
  other: { default: 0 },
};
// The claims-free discount a claim puts at risk, as a share of the yearly premium.
export const CLAIMS_FREE_DISCOUNT: Partial<Record<PolicyKind, number>> = {
  auto: 0.1,
  home: 0.05,
  renters: 0.03,
  rideshare: 0.05,
  boat: 0.05,
};
// A difference this small either way is a close call, not a clear answer.
export const CLAIM_CLOSE_CALL_CENTS = 5_000;

// --- Health cover all year (spec step 200) --------------------------------------------------
// Medical spending counted toward the plan: Plaid's MEDICAL_ detailed categories, less the
// ones a separate dental or vision plan pays (they still count toward an FSA).
export const HEALTH_PLAN_EXCLUDED_CATEGORIES: readonly string[] = [
  "MEDICAL_DENTAL_CARE",
  "MEDICAL_EYE_CARE",
];
// The day an FSA's unused money is lost: December 31, unless the employer allows a carryover.
export const FSA_DEADLINE = { month: 12, day: 31 } as const;
// Say the FSA is running out from this many days before the deadline, with this much left.
export const FSA_WARN_DAYS = 90;
export const FSA_WARN_MIN_CENTS = 5_000;
// A bill is checked against what the plan should have paid from this size.
export const BIG_BILL_MIN_CENTS = 50_000;
// And opens a dispute card when it was this much more than the person's share.
export const DISPUTE_TOLERANCE_CENTS = 10_000;
// The sample plan the demo bank's health year uses (nothing stored): an employer PPO.
export const DEMO_HEALTH_PLAN = {
  name: "Acme PPO",
  deductibleCents: 50_000,
  outOfPocketMaxCents: 300_000,
  coinsurance: 20,
} as const;
// The demo FSA election when no pay stub benefit is on file (the demo payroll's $100 a pay).
export const DEMO_FSA_ELECTION_CENTS = 240_000;
// The stand-in plan directory (spec step 200): who is in the plan's network. Matched on the
// name as it appears on a statement; anything not listed is "can't tell", never "out".
export const DEMO_NETWORK_DIRECTORY: readonly {
  match: RegExp;
  name: string;
  inNetwork: boolean;
}[] = [
  { match: /cvs/i, name: "CVS Pharmacy", inNetwork: true },
  { match: /bayview imaging/i, name: "Bayview Imaging Center", inNetwork: true },
  { match: /lakeside urgent/i, name: "Lakeside Urgent Care", inNetwork: false },
];

// --- Perfect coverage: what cover you need (spec step 274) ----------------------------------
// Every threshold the need calculators use. Demo advice only. Term life is LIFE_NEED above
// (income years, final expenses, schooling per dependant, less savings and cover in place).
// Disability: a policy should replace about this share of pay (the share most policies pay, and
// the one that leaves it untaxed), which is DISABILITY_PAY_SHARE in src/config/benefits.ts.
export const DISABILITY_NEED = { waitingDays: 90, benefitUntilAge: 65 } as const;
// Umbrella: net worth above the liability limits on car and home, rounded up to a step, between a
// first million and a most. It only applies at UMBRELLA_ASSETS_CENTS of net worth or more.
export const UMBRELLA_NEED = {
  stepCents: 100_000_000,
  minCents: 100_000_000,
  maxCents: 500_000_000,
} as const;
// A deductible the cash cushion can carry: the largest step on the ladder that is at most this
// share of liquid cash (so a claim never empties it), and never below the smallest step.
export const DEDUCTIBLE_CASH_SHARE = 0.5;
// Liability levels by net worth tier: car injury per person and per accident, home and renters
// liability. The higher tier applies from HIGHER_LIABILITY_NET_WORTH_CENTS of net worth.
export const LIABILITY_LEVELS = {
  base: {
    autoPerPersonCents: LIABILITY_TARGET_CENTS,
    autoPerAccidentCents: LIABILITY_TARGET_ACCIDENT_CENTS,
    homeCents: 30_000_000,
    rentersCents: 10_000_000,
  },
  higher: {
    autoPerPersonCents: 25_000_000,
    autoPerAccidentCents: 50_000_000,
    homeCents: 50_000_000,
    rentersCents: 30_000_000,
  },
} as const;
export const HIGHER_LIABILITY_NET_WORTH_CENTS = 25_000_000;

// --- Perfect coverage: options to pick from (spec step 275) ---------------------------------
// Disability options are a share of monthly pay: a cheaper one, the need, a better one.
export const DISABILITY_OPTION_SHARES = [0.5, 0.6, 0.7] as const;
// Life options: the cheaper one covers this share of the need; the longer one adds this many
// years of term.
export const LIFE_OPTION_CHEAPER_SHARE = 0.75;
export const LIFE_OPTION_LONGER_YEARS = 10;
// Most options shown for one need.
export const MAX_OPTIONS = 4;
// Jane's pick can't be surer than a sample price from the stand-in allows.
export const OPTION_PICK_CAP = 80;

// The most a liability-limits gap counts for when suggestions are ranked: the chance is small
// and the gap can be huge for a rich person, so the size alone must not put it first.
export const LIABILITY_WORTH_CAP_CENTS = 5_000_000;

// Kept perfect (spec step 280): which needs a life event can change, so the gaps it opens are
// shown with their reason. A new baby adds a dependant; a new job changes the pay and the cover
// through work; a move changes the home and its liability; a car bought adds a car to cover.
export const EVENT_NEEDS: Readonly<Record<string, readonly string[]>> = {
  new_baby: ["life", "disability", "umbrella"],
  new_job: ["life", "disability"],
  moving: ["home_liability", "renters_liability", "umbrella", "deductible"],
  car_bought: ["auto_liability", "umbrella", "deductible"],
  raise: ["life", "disability", "umbrella"],
  home_bought: ["home_liability", "umbrella", "deductible", "life"],
};
export const EVENT_REASONS: Readonly<Record<string, string>> = {
  new_baby: "the new baby",
  new_job: "the new job",
  moving: "the move",
  car_bought: "the new car",
  raise: "your raise",
  home_bought: "the home you bought",
};

// --- Business and side-gig cover (spec Step 201) --------------------------------------------
// Self-employed or gig income (the tax lane's signals, step 123) brings business cover into the
// profile. Counted over the last BUSINESS_LOOKBACK_DAYS days.
export const BUSINESS_LOOKBACK_DAYS = 365;
// Freelance, gig or shop money this big in the period, or the tax profile saying self-employed,
// means a business.
export const BUSINESS_MIN_INCOME_CENTS = 50_000;
// And at least this many payments of it: one Shopify payout from selling something isn't a
// business (real-user QA).
export const BUSINESS_MIN_PAYMENTS = 3;
// Deposits from a card-payment service are a business's sales (Jo's Square deposits).
export const BUSINESS_SALES_DEPOSIT = /\b(?:square|stripe|shopify|clover|toast|paypal)\b/i;
export const BUSINESS_LIABILITY_TARGET_CENTS = 100_000_000;
// Professional liability (errors and omissions) for contract and service work: the same level
// clients usually ask for.
export const BUSINESS_PROFESSIONAL_TARGET_CENTS = 100_000_000;
// A business owner whose gas spending averages this much a month drives for the business
// (to suppliers and customers), which a personal car policy doesn't cover.
export const BUSINESS_GAS_MIN_MONTHLY_CENTS = 4_000;
// Work driving that needs business use on the car, from the tax profile's mileage.
export const BUSINESS_MILES_MIN = 1_000;
// Electronics bought in the period that count as work equipment worth covering.
export const BUSINESS_EQUIPMENT_MIN_CENTS = 50_000;
// Stand-in yearly prices for the checkup (the partner quotes the policy itself).
export const BUSINESS_PROFESSIONAL_YEARLY_CENTS = 60_000;
export const BUSINESS_CAR_USE_YEARLY_CENTS = 30_000;
