// The tax facts Jane keeps about a person and their household (tax roadmap 1.3, step T9). Each fact
// is one key, true for one tax year (or for all years), per person in the household, with where it
// came from. The store is tax_facts / tax_household_members (src/lib/tax-facts/); the merge rule is
// src/planning/tax-engine/facts.ts. Never an SSN, ITIN, EIN or account number: only the flag
// person.ssn_valid_for_work (yes / no / unknown).

export type TaxFactType = "text" | "number" | "cents" | "boolean" | "choice" | "date";

export type TaxFactSpec = Readonly<{
  key: string;
  type: TaxFactType;
  choices?: readonly string[];
  // True for a fact that is asked again for each tax year (T22); false for one that stays true.
  yearScoped: boolean;
  // True for a fact held once per person of the household ("member"), not once for the filer.
  perMember: boolean;
  // Writing it is a sensitive event: it goes to audit_log, with the key and origin, never the value.
  sensitive: boolean;
  // True when a question spec exists or will (src/config/questions.ts), so Jane can ask for it.
  askable: boolean;
  label: string;
}>;

const spec = <const K extends string>(
  key: K,
  type: TaxFactType,
  label: string,
  more: Partial<Omit<TaxFactSpec, "key" | "type" | "label">> = {},
): TaxFactSpec & { readonly key: K } => ({
  key,
  type,
  label,
  yearScoped: true,
  perMember: false,
  sensitive: false,
  askable: false,
  ...more,
});

const YES_NO_UNSURE = ["yes", "no", "unsure"] as const;
const YES_NO_UNKNOWN = ["yes", "no", "unknown"] as const;

export const TAX_FACT_SPECS = [
  // Residency
  spec("residency.status", "choice", "Your status for US tax", {
    choices: ["citizen_or_green_card", "student_visa", "other_visa", "unsure"],
    sensitive: true,
    askable: true,
  }),
  spec("residency.first_visa_year", "number", "The year you first came to the US on a visa", {
    yearScoped: false,
    sensitive: true,
  }),
  spec("residency.visa_class", "choice", "Your visa class", {
    choices: ["F", "J", "M", "Q", "other"],
    sensitive: true,
    yearScoped: false,
  }),
  spec("home.state", "text", "The state you live in", { askable: true }),
  spec("home.ca_months", "number", "Months you lived in California"),
  spec("home.campus_housing", "boolean", "You live in campus housing"),
  // Filing
  spec("filing.status", "choice", "How you file taxes", {
    choices: ["single", "married_joint", "married_separate", "head_of_household"],
    askable: true,
  }),
  spec("filing.claimed_as_dependent", "choice", "Someone can claim you as a dependent", {
    choices: YES_NO_UNSURE,
    askable: true,
  }),
  spec("filing.lived_apart_last_6_months", "boolean", "You lived apart from your spouse"),
  spec("filing.spouse_itemizes", "boolean", "Your spouse itemizes"),
  // The household as the person said it: set once they have answered how many dependants they have,
  // so no members then means none, not not-yet-asked.
  spec("household.dependants_stated", "boolean", "You have told Jane who is in your household", {
    askable: true,
  }),
  // The marker that a person's older answers have been copied into the record for this year.
  spec("household.legacy_done", "boolean", "Jane has copied your earlier tax answers in"),
  // Person
  spec("person.birth_date", "date", "Your birth date (a date, a year, or two possible years)", {
    yearScoped: false,
    sensitive: true,
  }),
  spec("person.blind", "boolean", "You are blind", { sensitive: true }),
  spec("person.ssn_valid_for_work", "choice", "Your Social Security number is valid for work", {
    choices: YES_NO_UNKNOWN,
    sensitive: true,
  }),
  spec("person.full_time_student_months", "number", "Months you were a full-time student"),
  spec("person.half_time", "boolean", "You study at least half time", { askable: true }),
  spec("person.degree_program", "choice", "Your degree program", {
    choices: ["undergrad", "grad"],
  }),
  spec("person.postsecondary_years_before", "number", "Years of college before this one"),
  spec(
    "person.aotc_years_claimed",
    "number",
    "Years you have claimed the American opportunity credit",
  ),
  // Member (one per person in the household)
  spec("member.birth_date", "date", "Their birth date (a date, a year, or two possible years)", {
    yearScoped: false,
    perMember: true,
    sensitive: true,
  }),
  spec("member.months_lived_with_you", "number", "Months they lived with you", {
    perMember: true,
  }),
  spec("member.full_time_student", "boolean", "They are a full-time student", { perMember: true }),
  spec("member.disabled", "boolean", "They are permanently disabled", {
    perMember: true,
    sensitive: true,
  }),
  spec("member.ssn_valid_for_work", "choice", "Their Social Security number is valid for work", {
    choices: YES_NO_UNKNOWN,
    perMember: true,
    sensitive: true,
  }),
  spec("member.provides_over_half_support", "boolean", "They provide over half their own support", {
    perMember: true,
  }),
  spec("member.gross_income", "cents", "Their gross income", { perMember: true }),
  spec("member.files_joint", "boolean", "They file a joint return", { perMember: true }),
  // Education
  spec("edu.qualified_expenses_paid", "cents", "Qualified education expenses you paid"),
  spec("edu.tax_free_scholarships", "cents", "Tax-free scholarships"),
  spec("edu.taxable_scholarship", "cents", "Taxable scholarship"),
  spec("edu.employer_assistance", "cents", "Education help from an employer"),
  // Health
  spec("health.marketplace_months", "number", "Months with marketplace coverage", {
    sensitive: true,
  }),
  spec("health.premium_monthly", "cents", "Your monthly premium", { sensitive: true }),
  spec("health.slcsp_monthly", "cents", "The monthly premium of the benchmark plan", {
    sensitive: true,
  }),
  spec("health.aptc_monthly", "cents", "Your monthly advance premium credit", { sensitive: true }),
  spec("health.hdhp_coverage", "choice", "Your high-deductible plan covers", {
    choices: ["self", "family", "none"],
    sensitive: true,
  }),
  // Retirement
  spec("retirement.contributions", "cents", "What you put into a retirement account"),
  // Income
  spec("income.tips_qualified", "cents", "Qualified tips"),
  spec("income.overtime_premium", "cents", "The overtime premium you were paid"),
  // Loans
  spec("loan.student_interest_paid", "cents", "Student loan interest you paid"),
  spec("loan.car_interest_qualified", "cents", "Car loan interest that qualifies"),
  // Prior year
  spec("prior.total_tax", "cents", "Your total tax last year", { sensitive: true }),
  spec("prior.agi", "cents", "Your adjusted gross income last year", { sensitive: true }),
  // Spouse
  spec("spouse.earned_income", "cents", "What your spouse earned"),
  spec(
    "spouse.student_or_disabled_months",
    "number",
    "Months your spouse was a student or disabled",
  ),
] as const satisfies readonly TaxFactSpec[];

export type TaxFactKey = (typeof TAX_FACT_SPECS)[number]["key"];

export const TAX_FACT_KEYS: readonly TaxFactKey[] = TAX_FACT_SPECS.map((s) => s.key);

const SPEC_BY_KEY: ReadonlyMap<string, TaxFactSpec> = new Map(
  TAX_FACT_SPECS.map((s) => [s.key, s]),
);

export const isTaxFactKey = (key: string): key is TaxFactKey => SPEC_BY_KEY.has(key);

export function taxFactSpec(key: TaxFactKey): TaxFactSpec {
  return SPEC_BY_KEY.get(key)!;
}

// The year a fact that is not year-scoped is stored under.
export const NOT_YEAR_SCOPED = 0;

// Where a fact came from, strongest first: the first current row in this order is the value
// (src/planning/tax-engine/facts.ts), and any other current row that says something else is kept as
// a conflict. Among rows of one origin the newest wins.
export const TAX_FACT_ORIGINS = [
  "answer",
  "document",
  "connector",
  "transaction",
  "legacy",
] as const;
export type FactOrigin = (typeof TAX_FACT_ORIGINS)[number];
export const TAX_FACT_PRECEDENCE: readonly FactOrigin[] = TAX_FACT_ORIGINS;

export const isFactOrigin = (value: unknown): value is FactOrigin =>
  (TAX_FACT_ORIGINS as readonly unknown[]).includes(value);

// "known": the person said it or a confirmed document shows it. "inferred": worked out.
export const STORED_FACT_STATUSES = ["known", "inferred"] as const;
export type StoredFactStatus = (typeof STORED_FACT_STATUSES)[number];

// How sure each kind of source makes a fact, in whole percent (answers and confirmed documents 100).
export const TAX_FACT_CONFIDENCE = {
  answer: 100,
  document: 100,
  connector: 90,
  transaction: 70,
  legacy: 80,
  inferred: 60,
} as const;

// How likely each fact is to change an outcome when asked (value of information, T12). Uniform
// until a cited reason is written here: a missing key counts as 1.
export const TAX_FACT_PRIORS: Readonly<Partial<Record<TaxFactKey, number>>> = {};

// A finding already shown is shown again, with its text updated and no new card, only when its high
// end rises by this much (T12).
export const TAX_FINDING_RENOTIFY = { risePercent: 20, riseCents: 10_000 } as const;

// The fact written once a person's legacy answers have been copied in, so the copy happens once.
export const LEGACY_DONE_KEY: TaxFactKey = "household.legacy_done";

// A told residency (src/profile/facts.ts "tax_residency") and the record's value for it.
export const RESIDENCY_FROM_TOLD: Readonly<Record<string, string>> = {
  citizen: "citizen_or_green_card",
  student_visa: "student_visa",
  other_visa: "other_visa",
  unsure: "unsure",
};
export const TOLD_FROM_RESIDENCY: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(RESIDENCY_FROM_TOLD).map(([told, value]) => [value, told]),
);
