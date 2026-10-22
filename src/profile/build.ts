import {
  AGE_BAND_FROM,
  APPROACHING_ASSETS_CENTS,
  APPROACHING_PAYOFF_YEARS,
  BUSINESS_DEPOSITS_MIN,
  EARNER_ACTIVE_DAYS,
  PENSION_PATTERN,
  PET_PURCHASES_MIN,
  PROFILE_MONTHS,
  SALARY_DEPOSITS_MIN,
  STARTING_MAX_INCOME_CENTS,
  STARTING_MAX_SAVED_CENTS,
  TOLD_AGE_APPROACHING_FROM,
  TOLD_AGE_RETIRED_FROM,
  TOLD_AGE_STARTING_BELOW,
  TROUBLE_FEES_MIN,
  UNEVEN_DEPOSITS_MIN,
  TROUBLE_DEBT_MONTHS,
} from "@/config/profile";
import type { NeedPolicy } from "@/lib/insurance/need/types";
import { confidenceOf, evidenceText, type Source } from "./confidence";
import { FACT_SPECS, type FactKey, factSpec } from "./facts";

// The picture of you (spec step 253): one profile per person, built from their
// transactions, accounts, loans and answers. Pure: the loader (src/lib/profile.ts) gathers
// the rows. Every fact says where it came from (seen in the data, told by the person, or
// guessed from other facts) and how sure Jane is, worked out from the evidence.

export type ProfileTx = {
  date: string;
  amountCents: number;
  description: string;
  pfc: string | null;
  accountId: string;
};
export type ProfileAccount = {
  id: string;
  // What the bank calls it ("Inherited IRA"); read for a few tax signals (step 268).
  name?: string;
  type: string;
  subtype: string | null;
  balanceCents: number;
  // A card's limit, when the bank says (spec step 260); undefined or null when unknown.
  limitCents?: number | null;
};
// A holding with what it cost, for taxes on gains and losses (step 261).
export type ProfileHolding = {
  accountId: string;
  valueCents: number;
  basisCents: number | null;
  // Spec step 262: which fund it is, and whether it is cash, for the fund detectors.
  ticker?: string | null;
  isCash?: boolean;
};
export type ProfileLiability = {
  accountId: string;
  kind: string;
  aprBps: number | null;
  hasPmi: boolean | null;
  payoffDate: string | null;
};
// What the person told Jane: corrections on the profile and answers in other places.
export type Told = Partial<Record<FactKey, string | number | boolean>>;

export type ProfileInput = {
  today: string;
  transactions: readonly ProfileTx[];
  accounts: readonly ProfileAccount[];
  liabilities: readonly ProfileLiability[];
  // Optional: what each account holds. Absent when the loader did not read holdings.
  holdings?: readonly ProfileHolding[];
  told: Told;
  // What else is known about the person's setup in Jane (step 264); a sample person's is
  // given by ./sample.ts.
  extras?: {
    householdMembers: number;
    // The employer match left on the table at this year's pace, from the person's employer plan
    // and contributions (the same calculation as the chat's answer). Null: no plan known;
    // absent: not loaded (the sample people), so the detector assumes.
    matchPace?: {
      missedCents: number;
      payCents: number;
      matchRate: number;
      fullMatchRate: number;
      employeeRate: number;
    } | null;
    // RSU withholding that falls short, from the person's vests this year or, with none known,
    // an assumed share of their stock plan (the same figure as the chat's answer). Null: none.
    // What the person's subscriptions cost in a year, as the subscriptions page and the chat
    // count them (recurring charges that are subscriptions). Absent: not loaded.
    subscriptions?: { yearlyCents: number; count: number } | null;
    // A year of interest on the person's cards from their balances and rates (the chat's
    // figure). Null: not available, so the interest charges seen are used. Absent: not loaded.
    cardInterestYearCents?: number | null;
    // What Jane's open reshops of car and home cover would save a year (the switch card's and
    // the chat's figure); 0 when there are none. Absent: not loaded.
    insuranceShopSavingCents?: number;
    // The policies they have, for the cover-need gaps (spec step 277). Absent: not loaded.
    coverPolicies?: readonly NeedPolicy[];
    rsuGap?: {
      vestedCents: number;
      shortfallCents: number;
      marginalRate: number;
      assumed: boolean;
      stockCents: number;
    } | null;
  };
  // Policies read from uploaded documents that wait for the person's confirm (spec step 259).
  unreadPolicyDocuments?: number;
};

export type FactValue = string | number | boolean | null;
export type Fact = {
  key: FactKey;
  label: string;
  value: FactValue;
  source: Source;
  // A whole percentage worked out from the evidence (src/profile/confidence.ts).
  confidence: number;
  // Why, in a few words: "12 payroll deposits in 12 months of data".
  evidence: string;
};
export type Profile = {
  facts: Record<FactKey, Fact>;
  today: string;
  months: number;
};

const monthOf = (day: string) => day.slice(0, 7);
const addDaysTo = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// How many calendar months the data covers, up to a year.
export function monthsOfData(txs: readonly ProfileTx[], today: string): number {
  if (txs.length === 0) return 0;
  const first = txs.reduce((a, t) => (t.date < a ? t.date : a), today);
  const [fy, fm] = monthOf(first).split("-").map(Number);
  const [ty, tm] = monthOf(today).split("-").map(Number);
  return Math.min(PROFILE_MONTHS, Math.max(1, (ty - fy) * 12 + (tm - fm)));
}

const inYear = (txs: readonly ProfileTx[], today: string) => {
  const cutoff = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  return txs.filter((t) => t.date > cutoff && t.date <= today);
};

const yearsUntil = (today: string, day: string) =>
  (Date.parse(day) - Date.parse(today)) / (365.25 * 86_400_000);

export function buildProfile(input: ProfileInput): Profile {
  const { today, accounts, liabilities, told } = input;
  const txs = inYear(input.transactions, today);
  const months = monthsOfData(txs, today);
  const count = (f: (t: ProfileTx) => boolean) => txs.filter(f).length;
  const facts = {} as Record<FactKey, Fact>;
  const set = (key: FactKey, value: FactValue, source: Source, what: string, matches: number) => {
    const text = told[key];
    if (text !== undefined) {
      facts[key] = {
        key,
        label: factSpec(key)!.label,
        value: text,
        source: "told",
        confidence: confidenceOf("told", { months, matches: 0 }),
        evidence: evidenceText("told", { months, matches: 0 }, what),
      };
      return;
    }
    facts[key] = {
      key,
      label: factSpec(key)!.label,
      value,
      source,
      confidence: confidenceOf(source, { months, matches }),
      evidence: evidenceText(source, { months, matches }, what),
    };
  };
  // A fact the data can't show and the person hasn't told: not in the profile.
  const unknown = (key: FactKey) => {
    const text = told[key];
    facts[key] = {
      key,
      label: factSpec(key)!.label,
      value: text ?? null,
      source: text === undefined ? "guessed" : "told",
      confidence: text === undefined ? 0 : confidenceOf("told", { months, matches: 0 }),
      evidence: text === undefined ? "not known yet" : "you told me",
    };
  };

  // --- Income -----------------------------------------------------------------------
  const income = txs.filter((t) => t.amountCents < 0 && t.pfc?.startsWith("INCOME_"));
  const pension = income.filter(
    (t) => t.pfc === "INCOME_RETIREMENT_PENSION" || PENSION_PATTERN.test(t.description),
  );
  const salary = income.filter((t) => t.pfc === "INCOME_SALARY");
  const contractor = income.filter(
    (t) => t.pfc === "INCOME_CONTRACTOR" || t.pfc === "INCOME_GIG_ECONOMY",
  );
  const otherIncome = income.filter(
    (t) => t.pfc === "INCOME_OTHER" && !PENSION_PATTERN.test(t.description),
  );
  let pattern: "salary" | "uneven" | "business" | "pension" | "unknown" = "unknown";
  let patternMatches = 0;
  if (pension.length > 0 && salary.length < SALARY_DEPOSITS_MIN) {
    pattern = "pension";
    patternMatches = pension.length;
  } else if (salary.length >= SALARY_DEPOSITS_MIN) {
    pattern = "salary";
    patternMatches = salary.length;
  } else if (contractor.length >= UNEVEN_DEPOSITS_MIN) {
    pattern = "uneven";
    patternMatches = contractor.length;
  } else if (otherIncome.length >= BUSINESS_DEPOSITS_MIN) {
    pattern = "business";
    patternMatches = otherIncome.length;
  }
  if (pattern === "unknown") unknown("income_pattern");
  else set("income_pattern", pattern, "seen", "deposits", patternMatches);

  // Employers still paying: an old one that stopped is a job change, not another earner.
  const employers = new Map<string, number>();
  const activeSince = addDaysTo(today, -EARNER_ACTIVE_DAYS);
  const lastPaid = new Map<string, string>();
  for (const t of salary) {
    const name = t.description.replace(/\s+PAYROLL.*$/i, "").trim();
    if (!lastPaid.has(name) || t.date > lastPaid.get(name)!) lastPaid.set(name, t.date);
  }
  for (const t of salary) {
    const name = t.description.replace(/\s+PAYROLL.*$/i, "").trim();
    if (lastPaid.get(name)! >= activeSince) employers.set(name, (employers.get(name) ?? 0) + 1);
  }
  const topEmployer = [...employers.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topEmployer) set("employer", topEmployer[0], "seen", "paychecks", topEmployer[1]);
  else unknown("employer");
  const earners = employers.size;
  if (earners > 0) set("earners", earners, "seen", "payroll names", salary.length);
  else unknown("earners");

  const incomeTotal = income
    .filter((t) => !(t.pfc === "INCOME_TAX_REFUND" || t.pfc === "INCOME_INTEREST_EARNED"))
    .reduce((s, t) => s - t.amountCents, 0);
  const monthlyIncome = months > 0 ? Math.round(incomeTotal / months) : 0;
  if (income.length > 0) set("monthly_income", monthlyIncome, "seen", "deposits", income.length);
  else unknown("monthly_income");

  // --- Household and home -----------------------------------------------------------
  const childcare = count((t) => t.pfc === "GENERAL_SERVICES_CHILDCARE");
  if (childcare > 0) set("has_children", true, "seen", "childcare payments", childcare);
  else set("has_children", false, "guessed", "childcare payments", 0);
  const hasChildren = facts.has_children.value === true;
  const household = hasChildren ? "family" : earners >= 2 ? "couple" : "single";
  set(
    "household",
    household,
    "guessed",
    hasChildren ? "childcare payments" : "payroll names",
    hasChildren ? childcare : earners,
  );

  const mortgageAccounts = accounts.filter((a) => a.subtype === "mortgage");
  const mortgageLiab = liabilities.find((l) => l.kind === "mortgage");
  const rent = count(
    (t) =>
      t.pfc === "RENT_AND_UTILITIES_RENT" &&
      /RENT|APARTMENTS|PROPERT/i.test(t.description) &&
      !/HOME RENT/i.test(t.description),
  );
  const mortgagePayments = count((t) => t.pfc === "LOAN_PAYMENTS_MORTGAGE_PAYMENT");
  const homeRent = count((t) => /HOME RENT/i.test(t.description));
  if (mortgageAccounts.length > 0 || mortgagePayments > 0) {
    set(
      "housing",
      "own",
      "seen",
      "mortgage payments",
      Math.max(mortgagePayments, mortgageAccounts.length),
    );
  } else if (rent + homeRent > 0) {
    set("housing", "rent", "seen", "rent payments", rent + homeRent);
  } else if (accounts.length > 0 && income.some((t) => PENSION_PATTERN.test(t.description))) {
    // No rent, no mortgage, a pension: owns outright, a guess.
    set("housing", "own", "guessed", "rent or mortgage payments", 0);
  } else unknown("housing");
  if (mortgageLiab?.aprBps != null)
    set("mortgage_rate_bps", mortgageLiab.aprBps, "seen", "mortgage records", 1);
  else unknown("mortgage_rate_bps");
  if (mortgageLiab?.hasPmi != null)
    set("has_pmi", mortgageLiab.hasPmi, "seen", "mortgage records", 1);
  else unknown("has_pmi");

  const carSigns =
    count(
      (t) =>
        t.pfc === "LOAN_PAYMENTS_CAR_PAYMENT" ||
        t.pfc === "TRANSPORTATION_GAS" ||
        /AUTO/i.test(t.description),
    ) + accounts.filter((a) => a.subtype === "auto").length;
  set("has_car", carSigns > 0, "guessed", "car payments, gas or auto cover", carSigns);
  const petSigns = count(
    (t) => t.pfc === "GENERAL_MERCHANDISE_PET_SUPPLIES" || t.pfc === "MEDICAL_VETERINARY_SERVICES",
  );
  set("has_pet", petSigns >= PET_PURCHASES_MIN, "guessed", "pet purchases", petSigns);

  // --- Debts ------------------------------------------------------------------------
  const cardIds = new Set(accounts.filter((a) => a.type === "credit").map((a) => a.id));
  const cardDebt = accounts
    .filter((a) => cardIds.has(a.id))
    .reduce((s, a) => s + Math.max(0, a.balanceCents), 0);
  set("card_debt_cents", cardDebt, "seen", "cards linked", cardIds.size);
  const fees = count(
    (t) =>
      t.pfc === "BANK_FEES_OVERDRAFT_FEES" ||
      t.pfc === "BANK_FEES_INSUFFICIENT_FUNDS" ||
      t.pfc === "BANK_FEES_LATE_FEES",
  );
  const payday = count(
    (t) => t.pfc === "LOAN_PAYMENTS_CASH_ADVANCES" || t.pfc === "LOAN_PAYMENTS_EWA",
  );
  set("has_payday_loan", payday > 0, "seen", "cash-advance repayments", payday);
  const overweight = monthlyIncome > 0 && cardDebt >= monthlyIncome * TROUBLE_DEBT_MONTHS;
  // The evidence is the signal that decided it, counted once (overdraft and late fees, else
  // cash-advance repayments, else the card debt), not all of them added together.
  const troubleSignal =
    fees >= TROUBLE_FEES_MIN
      ? { what: "overdraft, insufficient-funds or late fees", n: fees }
      : payday > 0
        ? { what: "cash-advance repayments", n: payday }
        : { what: "months of income owed on cards", n: overweight ? TROUBLE_DEBT_MONTHS : 0 };
  set(
    "debt_trouble",
    fees >= TROUBLE_FEES_MIN || payday > 0 || overweight,
    "seen",
    troubleSignal.what,
    troubleSignal.n,
  );

  // --- Accounts and cover -----------------------------------------------------------
  const has = (subtype: string) => accounts.some((a) => a.subtype === subtype);
  set(
    "has_401k",
    has("401k"),
    "seen",
    "retirement accounts",
    accounts.filter((a) => a.subtype === "401k").length,
  );
  set("has_hsa", has("hsa"), "seen", "HSAs", accounts.filter((a) => a.subtype === "hsa").length);
  set(
    "has_stock_plan",
    has("stock plan"),
    "seen",
    "stock plans",
    accounts.filter((a) => a.subtype === "stock plan").length,
  );
  const cover = (pattern: RegExp) =>
    count(
      (t) =>
        (t.pfc === "GENERAL_SERVICES_INSURANCE" || t.pfc === "MEDICAL_OTHER_MEDICAL") &&
        pattern.test(t.description),
    );
  for (const [key, pattern, what] of [
    ["insurance_auto", /AUTO|GEICO|PROGRESSIVE/i, "car-cover charges"],
    ["insurance_home", /HOME|HOMEOWNERS|RENTERS/i, "home-cover charges"],
    ["insurance_life", /LIFE|NEW YORK LIFE|TERM/i, "life-cover charges"],
    ["insurance_health", /HEALTHCARE|MARKETPLACE|BLUE CROSS|AETNA/i, "health-cover charges"],
    ["insurance_medigap", /MEDIGAP|SUPPLEMENT|MEDICARE/i, "Medicare cover charges"],
  ] as const) {
    const n = cover(pattern);
    set(key, n > 0, "seen", what, n);
  }

  // --- Told: age and risk -----------------------------------------------------------
  // Told-only facts: not in the data, so unknown until the person says (steps 253 and 257).
  for (const key of [
    "age",
    "age_band",
    "risk",
    "employer_match",
    "filing_status",
    "business_structure",
    "hardship_reason",
    "inherited_ira_death_year",
    "inherited_from_spouse",
  ] as const) {
    if (told[key] === undefined) unknown(key);
    else set(key, told[key], "told", "answers", 0);
  }

  // --- Life stage -------------------------------------------------------------------
  const invested = accounts
    .filter((a) => a.type === "investment")
    .reduce((s, a) => s + a.balanceCents, 0);
  const payoffYears = mortgageLiab?.payoffDate ? yearsUntil(today, mortgageLiab.payoffDate) : null;
  // An exact age wins; otherwise the band they picked.
  const band = typeof told.age_band === "string" ? AGE_BAND_FROM[told.age_band] : undefined;
  const age = typeof told.age === "number" ? told.age : (band ?? null);
  let stage: "starting" | "raising" | "peak" | "approaching" | "retired";
  let stageMatches = 1;
  if (age !== null) {
    stage =
      age >= TOLD_AGE_RETIRED_FROM && pattern === "pension"
        ? "retired"
        : age >= TOLD_AGE_APPROACHING_FROM
          ? "approaching"
          : age < TOLD_AGE_STARTING_BELOW
            ? "starting"
            : hasChildren
              ? "raising"
              : "peak";
  } else if (pattern === "pension") stage = "retired";
  else if (
    invested >= APPROACHING_ASSETS_CENTS &&
    payoffYears !== null &&
    payoffYears <= APPROACHING_PAYOFF_YEARS
  )
    stage = "approaching";
  else if (hasChildren) stage = "raising";
  else if (
    pattern === "salary" &&
    monthlyIncome <= STARTING_MAX_INCOME_CENTS &&
    invested <= STARTING_MAX_SAVED_CENTS &&
    facts.housing.value !== "own"
  )
    stage = "starting";
  else stage = "peak";
  stageMatches = Math.max(
    1,
    Math.min(3, [pattern !== "unknown", hasChildren, invested > 0].filter(Boolean).length),
  );
  set("life_stage", stage, age !== null ? "seen" : "guessed", "signals", stageMatches);

  // Keep every key present, in the declared order.
  const ordered = {} as Record<FactKey, Fact>;
  for (const spec of FACT_SPECS) ordered[spec.key] = facts[spec.key];
  return { facts: ordered, today, months };
}
