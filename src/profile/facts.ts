// The facts in a person's profile (spec step 253). Each has a plain label, a kind (so a
// correction can be checked) and whether the person may correct it. Detectors (step 254)
// ask for these by key.

export type FactKind = "choice" | "boolean" | "number" | "text" | "cents";

export type FactSpec = {
  key: string;
  label: string;
  kind: FactKind;
  choices?: readonly string[];
  // False for what the bank itself reports (balances).
  correctable: boolean;
};

const F = (
  key: string,
  label: string,
  kind: FactKind,
  extra: { choices?: readonly string[]; correctable?: boolean } = {},
): FactSpec => ({
  key,
  label,
  kind,
  choices: extra.choices,
  correctable: extra.correctable ?? true,
});

export const FACT_SPECS = [
  F("income_pattern", "How you're paid", "choice", {
    choices: ["salary", "uneven", "business", "pension", "unknown"],
  }),
  F("employer", "Your employer", "text"),
  F("earners", "People in your household earning a salary", "number"),
  F("monthly_income", "Money coming in each month", "cents"),
  F("household", "Your household", "choice", { choices: ["single", "couple", "family"] }),
  F("has_children", "You have children at home", "boolean"),
  F("housing", "Where you live", "choice", { choices: ["own", "rent", "unknown"] }),
  F("mortgage_rate_bps", "Your mortgage rate (in basis points)", "number", { correctable: false }),
  F("has_pmi", "Your mortgage includes PMI", "boolean", { correctable: false }),
  F("has_car", "You have a car", "boolean"),
  F("has_pet", "You have a pet", "boolean"),
  F("card_debt_cents", "Credit card debt", "cents", { correctable: false }),
  F("has_payday_loan", "You use a payday or cash-advance loan", "boolean"),
  F("debt_trouble", "You're struggling with debt", "boolean"),
  F("has_401k", "You have a 401(k)", "boolean"),
  F("has_hsa", "You have an HSA", "boolean"),
  F("has_stock_plan", "You get company stock", "boolean"),
  F("insurance_auto", "You pay for car insurance", "boolean"),
  F("insurance_home", "You pay for home insurance", "boolean"),
  F("insurance_life", "You pay for life insurance", "boolean"),
  F("insurance_health", "You pay for health insurance yourself", "boolean"),
  F("insurance_medigap", "You pay for Medicare supplement cover", "boolean"),
  F("age", "Your age", "number"),
  F("inherited_ira_death_year", "The year the person you inherited an IRA from died", "number"),
  F("marketplace_aptc_monthly", "The advance premium tax credit you get each month", "cents"),
  F(
    "marketplace_benchmark_monthly",
    "The monthly premium of the benchmark plan on your Marketplace quote",
    "cents",
  ),
  F("inherited_from_spouse", "You inherited the IRA from your spouse", "boolean"),
  F("age_band", "Your age, roughly", "choice", {
    choices: ["under_30", "30_to_49", "50_to_57", "58_to_65", "66_to_72", "73_plus"],
  }),
  F("employer_match", "Your job matches your 401(k) contributions", "choice", {
    choices: ["yes", "no"],
  }),
  F("filing_status", "How you file taxes", "choice", {
    choices: ["single", "married_joint", "married_separate", "head_of_household"],
  }),
  F("business_structure", "How your business is set up", "choice", {
    choices: ["sole_proprietor", "llc", "s_corp", "other"],
  }),
  F("hardship_reason", "What put you in debt trouble", "choice", {
    choices: ["job_loss", "medical", "overspending", "other"],
  }),
  F("risk", "How you feel about investment ups and downs", "text"),
  F("life_stage", "Where you are in life", "choice", {
    choices: ["starting", "raising", "peak", "approaching", "retired"],
  }),
] as const satisfies readonly FactSpec[];

export type FactKey = (typeof FACT_SPECS)[number]["key"];
export const FACT_KEYS = FACT_SPECS.map((f) => f.key) as readonly FactKey[];
export const factSpec = (key: string): FactSpec | undefined =>
  FACT_SPECS.find((f) => f.key === key);
