import { FIT_CARD_PAYMENT_SHARE } from "@/config/fit";
import { troubleReason } from "@/planning/debt-trouble";
import {
  AGE_BAND_FROM,
  APPROACHING_ASSETS_CENTS,
  APPROACHING_PAYOFF_YEARS,
  BUSINESS_DEPOSITS_MIN,
  EARNER_ACTIVE_DAYS,
  CAR_WORDS,
  PENSION_PATTERN,
  PROFILE_MONTHS,
  SALARY_DEPOSITS_MIN,
  STARTING_MAX_INCOME_CENTS,
  STARTING_MAX_SAVED_CENTS,
  TOLD_AGE_APPROACHING_FROM,
  TOLD_AGE_RETIRED_FROM,
  TOLD_AGE_STARTING_BELOW,
  UNEVEN_DEPOSITS_MIN,
  TROUBLE_DEBT_MONTHS,
} from "@/config/profile";
import type { WorthKind } from "@/detectors/contract";
import type { Relief } from "@/config/disasters";
import type { DraftFinding } from "@/planning/draft-return";
import type { NeedPolicy } from "@/lib/insurance/need/types";
import { countyFromPayments, countyOf } from "@/planning/disasters";
import { confidenceOf, evidenceText, type Source } from "./confidence";
import { FACT_SPECS, type FactKey, factSpec } from "./facts";
import { addDays } from "@/lib/dates";
import { normalizeMerchant, withoutAchDetails } from "@/data-sources/merchant";
import type { PolicyKind } from "@/config/insurance";
import { insurerKind } from "@/insights/found-policies";
import { lifeEventGuesses } from "@/insights/life-signals";
import type { DetectionInput } from "@/detection/types";
import { CAR_SIGNAL, KIDS_SIGNALS, NEW_BABY_RECENT_DAYS } from "@/config/life-facts";
import {
  commuteReading,
  eatingReading,
  fitnessReading,
  healthCostReading,
  hitsOf,
  kidsReading,
  ownerBills,
  petReading,
  sideGigReading,
  studentReading,
  travelReading,
} from "./life-facts";

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
  // False when the bank (or the uploaded file) gave no balance, so balanceCents is a stand-in 0
  // (overnight upload QA: card CSVs and some checking exports carry none). Absent: known.
  balanceKnown?: boolean;
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
  // What's due each month as the bank says (a card's minimum); absent when not loaded.
  minimumCents?: number | null;
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
  // Spec step 236: what the person asked Jane to leave out of their funds (keys in
  // src/config/values.ts), when they have said.
  valuesExcludes?: readonly string[];
  // Spec step 237: ids of the accounts that have a beneficiary named. Absent when the loader
  // did not read them.
  namedAccountIds?: readonly string[];
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
    // Cards (account ids) not in cardInterestYearCents because their balance or rate isn't
    // known: their interest is counted from the charges seen. Absent: none.
    cardInterestUnknownCards?: readonly string[];
    // What Jane's open reshops of car and home cover would save a year (the switch card's and
    // the chat's figure); 0 when there are none. Absent: not loaded.
    insuranceShopSavingCents?: number;
    // The policies they have, for the cover-need gaps (spec step 277). Absent: not loaded.
    coverPolicies?: readonly NeedPolicy[];
    // What doesn't add up in the person's data (spec step 238), from the daily books check.
    // Absent: not loaded.
    books?: readonly { kind: string; words: string; accountId: string | null }[];
    // Disaster relief declarations from the person's feed (spec step 270): the stand-in's
    // samples for demo-bank people, none for anyone else. Absent: not loaded.
    disasterRelief?: readonly Relief[];
    // This year's contributions an HSA's bank reports on the account itself (investment
    // transactions, taxes QA). Absent: not loaded; null: no HSA.
    hsaContributions?: { cents: number; count: number } | null;
    // The latest confirmed draft return's check (spec step 272): what it found, by line, with the
    // tax each changes. Null: no checked draft. Absent: not loaded.
    draftReturn?: { year: number; findings: readonly DraftFinding[] } | null;
    // The value of what they own (a home, cars), added to their net worth for the umbrella.
    ownedValueCents?: number;
    // The person already has a practice portfolio (step 296). Absent: not loaded.
    hasPracticePortfolio?: boolean;
    // Whether the household chose how shared bills split (spec step 242). Absent: not loaded.
    splitChosen?: boolean;
    // Savings goals still on the way (spec step 241), in the order they're funded, and the
    // room the year plan has for them this month. Absent: not loaded.
    goals?: readonly {
      id: string;
      name: string;
      leftCents: number;
      wantedMonth: string;
      monthlyCents: number;
    }[];
    goalRoomCents?: number | null;
    // Last month's close (spec step 244): closed, waiting or none yet. Absent: not loaded.
    lastCloseStatus?: "closed" | "waiting" | null;
    rsuGap?: {
      vestedCents: number;
      shortfallCents: number;
      marginalRate: number;
      assumed: boolean;
      stockCents: number;
    } | null;
    // The practice scan's ideas waiting for the person, newest first. Absent: not loaded.
    practiceIdeas?: readonly PracticeIdea[];
  };
  // Policies read from uploaded documents that wait for the person's confirm (spec step 259).
  unreadPolicyDocuments?: number;
  // The person's health plan terms and FSA election, where Jane has them (spec step 259):
  // from a confirmed policy and the pay stub. null/absent when it hasn't.
  healthPlan?: {
    label: string;
    deductibleCents: number;
    outOfPocketMaxCents: number | null;
    coinsurance: number;
  } | null;
  fsaElectionCents?: number | null;
  // The latest credit score pulled (spec step 116), so detectors price loans by the same band
  // as the chat and the pages; null before a pull, absent when not loaded (the sample people).
  creditScore?: number | null;
  // The person turned rent reporting on (spec step 248).
  rentReportingOn?: boolean;
  // Spec step 249: people the person has an authorized user or first card for, and what they
  // co-signed (owed, in cents) for someone.
  familyCredit?: {
    helped: number;
    cosignedOwedCents: number;
    cosignedMissed: number;
    // The co-signed loans' payments a month: lenders count them as the person's own debt.
    cosignedPaymentCents?: number;
  };
};

// One idea from the practice portfolio's scan waiting for the person (Phase AW, Stage A): a flag
// kept as "suggested", with its short forms, numbers, caps and how sure Jane is.
export type PracticeIdea = {
  key: string;
  kind: string;
  scannedAt: string;
  // What the kind is called ("Put idle cash to work").
  label: string;
  headline: string;
  short: string;
  worthCents: number;
  worthKind: WorthKind;
  figures: readonly { label: string; value: string }[];
  caps: readonly string[];
  confidence: { percent: number; reason: string };
  // How many practice trades a Yes places (0: it opens the settings instead).
  trades: number;
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
  // Calendar months of data, for "in N months of data" and confidence.
  months: number;
  // The months a rate is spread over (monthsForRate): the real span of a short history. Absent
  // on profiles made by hand; rateMonthsOf falls back to months.
  rateMonths?: number;
};

// What a monthly or yearly rate divides by (night QA 10-30: Aug 1 to Oct 26 is "2 months" by the
// calendar, so payments, premiums and interest read 1.5 times their pace).
export const rateMonthsOf = (profile: Pick<Profile, "months" | "rateMonths">) =>
  profile.rateMonths ?? Math.max(1, profile.months);

// How many months the data covers, up to a year: the days from the first day to today, in average
// months. The one count, here and on the report (debugger 10-30: one page said "11 months of
// data" by calendar months, Nov to Oct, and "12 months" by days, for the same year).
// Whole months, with a few days' slack so a statement a few days short of a month still counts
// (a year from Nov 2 to Oct 28 is 12), and a part month never rounds up (3.5 months is 3: thin
// data stays modest).
const MONTH_SLACK = 0.2;
export function monthsCovered(first: string, today: string): number {
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000;
  const months = Math.floor((days + 1) / (365.25 / 12) + MONTH_SLACK);
  return Math.min(PROFILE_MONTHS, Math.max(1, months));
}

// The last day the statements reach, never past today (review 10-30: statements from Jan to Mar
// seen in October read as "10 months of data", and rates were spread over ten months).
// Statements whose newest line is within STALE_AFTER_DAYS of today still reach today (a quiet
// week isn't missing data); older ones end a few days after their last line, where a statement
// period closes.
const STALE_AFTER_DAYS = 35;
const STATEMENT_TAIL_DAYS = 7;
function lastDayOf(txs: readonly ProfileTx[], today: string): string {
  return statementsEnd(
    txs.reduce((a, t) => (t.date > a && t.date <= today ? t.date : a), ""),
    today,
  );
}

// Where statements whose newest line is `last` reach. Also the report page's (one count).
export function statementsEnd(last: string, today: string): string {
  if (!last || last >= today) return today;
  const gap = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000;
  if (gap <= STALE_AFTER_DAYS) return today;
  return new Date(Date.parse(`${last}T00:00:00Z`) + STATEMENT_TAIL_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export function monthsOfData(txs: readonly ProfileTx[], today: string): number {
  if (txs.length === 0) return 0;
  const first = txs.reduce((a, t) => (t.date < a ? t.date : a), today);
  return monthsCovered(first, lastDayOf(txs, today));
}

// The months a monthly rate is spread over. A full year is the calendar count; a shorter history
// uses the real span in days, because the calendar count rounds a 90-day history to two or three
// "months" and a rate taken over two would read a third too high.
export function monthsForRate(txs: readonly ProfileTx[], today: string): number {
  const whole = monthsOfData(txs, today);
  if (whole === 0 || whole >= PROFILE_MONTHS) return whole;
  const first = txs.reduce((a, t) => (t.date < a ? t.date : a), today);
  const last = lastDayOf(txs, today);
  const days = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000;
  return Math.max(1, (days + 1) / (365.25 / 12));
}

const inYear = (txs: readonly ProfileTx[], today: string) => {
  const cutoff = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  return txs.filter((t) => t.date > cutoff && t.date <= today);
};

// Debt payments are averaged over this many days before today.
const TROUBLE_PAYMENT_DAYS = 90;

const yearsUntil = (today: string, day: string) =>
  (Date.parse(day) - Date.parse(today)) / (365.25 * 86_400_000);

// The payments as the life-event guesses (spec step 100) read them, so a recent move or a new baby
// is worked out by the one code the "life events" suggestion uses too.
function detectionInputOf(input: ProfileInput, txs: readonly ProfileTx[]): DetectionInput {
  return {
    asOf: input.today,
    accounts: input.accounts.map((a) => ({
      id: a.id,
      name: a.id,
      type: a.type,
      subtype: a.subtype,
      currentBalanceCents: a.balanceCents,
    })),
    transactions: txs.map((t, i) => ({
      id: `${i}`,
      accountId: t.accountId,
      plaidTransactionId: null,
      date: t.date,
      amountCents: t.amountCents,
      description: t.description,
      merchantName: null,
      pfcPrimary: null,
      pfcDetailed: t.pfc,
      categorySource: null,
    })),
    recurringStreams: [],
  };
}

// A new baby: the life-event guess (baby merchants plus a hospital bill, spec step 100), or baby
// goods bought lately and nothing for children before them.
function babyReading(input: ProfileInput, txs: readonly ProfileTx[], today: string) {
  const guess = lifeEventGuesses(detectionInputOf(input, txs)).find((g) => g.kind === "new_baby");
  if (guess) {
    return {
      value: true,
      source: "seen" as const,
      what: "baby-goods and hospital payments",
      matches: guess.signals.length,
    };
  }
  const goods = hitsOf(txs, KIDS_SIGNALS.babyGoods);
  const recent = goods.txs.filter((t) => t.date > addDays(today, -NEW_BABY_RECENT_DAYS));
  const earlier = txs.filter((t) => t.date <= addDays(today, -NEW_BABY_RECENT_DAYS));
  const older = Object.values(KIDS_SIGNALS).some((signal) => hitsOf(earlier, signal).matches > 0)
    ? [1]
    : [];
  if (
    recent.length >= KIDS_SIGNALS.babyGoods.minMatches &&
    recent.length === goods.matches &&
    older.length === 0
  ) {
    return {
      value: true,
      source: "guessed" as const,
      what: "baby-goods payments",
      matches: recent.length,
    };
  }
  return {
    value: false,
    source: "guessed" as const,
    what: "baby-goods payments",
    matches: recent.length,
  };
}

// The payer on a paycheck line: no ACH details, no bank's "Deposit from" (Capital One 360) or
// "DEPOSIT - " (Navy Federal) in front, and nothing from "PAYROLL" on (debugger 11-01).
function employerName(description: string): string {
  return withoutAchDetails(description)
    .replace(/^(?:DEPOSIT FROM|DEPOSIT -)\s+/i, "")
    .replace(/\s+PAYROLL.*$/i, "")
    .trim();
}

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
  const activeSince = addDays(today, -EARNER_ACTIVE_DAYS);
  const lastPaid = new Map<string, string>();
  for (const t of salary) {
    const name = employerName(t.description);
    if (!lastPaid.has(name) || t.date > lastPaid.get(name)!) lastPaid.set(name, t.date);
  }
  for (const t of salary) {
    const name = employerName(t.description);
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
  const monthlyIncome = months > 0 ? Math.round(incomeTotal / monthsForRate(txs, today)) : 0;
  if (income.length > 0) set("monthly_income", monthlyIncome, "seen", "deposits", income.length);
  else unknown("monthly_income");

  // --- Household and home -----------------------------------------------------------
  const kids = kidsReading(txs);
  set("has_children", kids.value, kids.source, kids.what, kids.matches);
  const hasChildren = facts.has_children.value === true;
  const household = hasChildren ? "family" : earners >= 2 ? "couple" : "single";
  set(
    "household",
    household,
    "guessed",
    hasChildren ? kids.what : "payroll names",
    hasChildren ? kids.matches : earners,
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
  } else if (ownerBills(txs).seen && rent + homeRent === 0) {
    // Dues and property tax with no rent: the bills of someone who owns.
    set(
      "housing",
      "own",
      "seen",
      "homeowner dues and property tax payments",
      ownerBills(txs).matches,
    );
  } else if (rent + homeRent > 0) {
    set("housing", "rent", "seen", "rent payments", rent + homeRent);
  } else if (accounts.length > 0 && income.some((t) => PENSION_PATTERN.test(t.description))) {
    // No rent, no mortgage, a pension: owns outright, a guess.
    set("housing", "own", "guessed", "rent or mortgage payments", 0);
  } else if (ownerBills(txs).met) {
    // A little property tax or dues and nothing else to go on: a guess.
    set(
      "housing",
      "own",
      "guessed",
      "homeowner dues and property tax payments",
      ownerBills(txs).matches,
    );
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
        CAR_WORDS.test(t.description) ||
        // Parking, tolls, cover and upkeep (src/config/life-facts.ts).
        hitsOf([t], CAR_SIGNAL).matches > 0,
    ) + accounts.filter((a) => a.subtype === "auto").length;
  // Still a guess however many signs: gas can be a borrowed or rented car, and the cover
  // suggestions read this as "probably" (the insurance lane's tests rest on it).
  set("has_car", carSigns > 0, "guessed", "car payments, gas, tolls or auto cover", carSigns);
  const pet = petReading(txs);
  set("has_pet", pet.value, pet.source, pet.what, pet.matches);
  // --- The rest of the picture of their life, from their payments ---------------------
  const baby = txs.length > 0 ? babyReading(input, txs, today) : null;
  set(
    "new_baby",
    baby?.value ?? false,
    baby?.source ?? "guessed",
    baby?.what ?? "baby-goods payments",
    baby?.matches ?? 0,
  );
  const student = studentReading(txs);
  set("is_student", student.value, student.source, student.what, student.matches);
  const salaried = facts.income_pattern.value === "salary";
  const work = commuteReading(txs, months, salaried);
  if (work) set("work_style", work.value, work.source, work.what, work.matches);
  else unknown("work_style");
  const trips = travelReading(txs);
  set("travels_often", trips.value, trips.source, trips.what, trips.matches);
  const gym = fitnessReading(txs);
  set("goes_to_gym", gym.value, gym.source, gym.what, gym.matches);
  const eating = eatingReading(txs);
  if (eating) set("eating_style", eating.value, eating.source, eating.what, eating.matches);
  else unknown("eating_style");
  const gig = sideGigReading(txs, salaried);
  set("side_gig", gig.value, gig.source, gig.what, gig.matches);
  const health = healthCostReading(txs, months);
  set("health_costs", health.value, health.source, health.what, health.matches);
  const moved = lifeEventGuesses(detectionInputOf(input, txs)).find((g) => g.kind === "moving");
  set(
    "moved_recently",
    moved !== undefined,
    moved ? "seen" : "guessed",
    "moving signs",
    moved?.signals.length ?? 0,
  );

  // --- Debts ------------------------------------------------------------------------
  const cardIds = new Set(accounts.filter((a) => a.type === "credit").map((a) => a.id));
  const cardDebt = accounts
    .filter((a) => cardIds.has(a.id))
    .reduce((s, a) => s + Math.max(0, a.balanceCents), 0);
  // With no card linked the data can't say what's owed on cards (QA: "Credit card debt = $0,
  // 63% sure, based on no cards linked").
  if (cardIds.size > 0) set("card_debt_cents", cardDebt, "seen", "cards linked", cardIds.size);
  else unknown("card_debt_cents");
  const payday = count(
    (t) => t.pfc === "LOAN_PAYMENTS_CASH_ADVANCES" || t.pfc === "LOAN_PAYMENTS_EWA",
  );
  set("has_payday_loan", payday > 0, "seen", "cash-advance repayments", payday);
  const paydayRepaid = txs
    .filter(
      (t) =>
        (t.pfc === "LOAN_PAYMENTS_CASH_ADVANCES" || t.pfc === "LOAN_PAYMENTS_EWA") &&
        t.amountCents > 0,
    )
    .reduce((s, t) => s + t.amountCents, 0);
  // Debt payments against income, by step 229's rule (src/config/debt-trouble.ts): every loan
  // payment seen in the last three months (a card's is its minimum, not a statement paid in
  // full) at or above TROUBLE_PAYMENT_SHARE of take-home.
  const since = addDays(today, -TROUBLE_PAYMENT_DAYS);
  const loanPaid = txs
    .filter(
      (t) =>
        (t.pfc ?? "").startsWith("LOAN_PAYMENTS_") &&
        t.pfc !== "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" &&
        t.amountCents > 0 &&
        t.date > since,
    )
    .reduce((s, t) => s + t.amountCents, 0);
  const debtPayments =
    Math.round((loanPaid * 30) / TROUBLE_PAYMENT_DAYS) +
    Math.round(cardDebt * FIT_CARD_PAYMENT_SHARE);
  const liquid = accounts
    .filter((a) => a.type === "depository")
    .reduce((s, a) => s + Math.max(0, a.balanceCents), 0);
  // Debt trouble rests on the debts themselves (loans QA): payday loans, card balances against
  // income, debt payments against income, by the one judgement /loans/help makes too
  // (troubleReason). Overdraft and late fees are a spending finding (bank_fees, late_fees), not
  // debt trouble by themselves. The evidence is the signal that decided it, counted once.
  const reason = troubleReason({
    monthlyIncomeCents: monthlyIncome,
    cardDebtCents: cardDebt,
    paydayRepayments: payday,
    paydayRepaidCents: paydayRepaid,
    debtPaymentsCents: debtPayments,
    cashCents: liquid,
  });
  const troubleSignal =
    reason === "payday_cycle"
      ? { what: "cash-advance repayments", n: payday }
      : reason === "card_debt"
        ? { what: "months of income owed on cards", n: TROUBLE_DEBT_MONTHS }
        : reason === "payments"
          ? {
              what: "months of debt payments over 40% of income, without the cash to carry them",
              n: 3,
            }
          : { what: "debt signals", n: 0 };
  set("debt_trouble", reason !== null, "seen", troubleSignal.what, troubleSignal.n);

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
  // Spec step 270: the county, as the property tax payee names it ("HARRIS COUNTY TAX ...").
  const county = countyFromPayments(txs);
  if (county)
    set(
      "county",
      county,
      "seen",
      "property tax payments naming it",
      count((t) => t.amountCents > 0 && countyOf(t.description) === county),
    );
  else unknown("county");
  set(
    "has_stock_plan",
    has("stock plan"),
    "seen",
    "stock plans",
    accounts.filter((a) => a.subtype === "stock plan").length,
  );
  // The cover's words, or a known insurer of that kind (src/config/found-policies.ts): State
  // Farm's "STATE FARM RO 27 SFPP" is car cover (debugger 11-01: a driver paying it was told
  // "Check your car is insured").
  const insurerOf = (t: ProfileTx) => {
    const key = normalizeMerchant(t.description)?.key;
    return key ? insurerKind(key) : null;
  };
  const cover = (pattern: RegExp, kinds: readonly PolicyKind[]) =>
    count((t) => {
      if (t.pfc !== "GENERAL_SERVICES_INSURANCE" && t.pfc !== "MEDICAL_OTHER_MEDICAL") return false;
      const insurer = insurerOf(t);
      return pattern.test(t.description) || (insurer !== null && kinds.includes(insurer));
    });
  for (const [key, pattern, kinds, what] of [
    // Whole words, and "AUTOPAY" isn't car cover (debugger 11-01: a life premium's "AUTOPAY").
    [
      "insurance_auto",
      /\b(?:AUTO(?![ -]?PAY)|GEICO|PROGRESSIVE)\b/i,
      ["auto"],
      "car-cover charges",
    ],
    [
      "insurance_home",
      /\b(?:HOME|HOMEOWNERS|RENTERS)\b/i,
      ["home", "renters"],
      "home-cover charges",
    ],
    ["insurance_life", /\b(?:LIFE|TERM)\b/i, ["life"], "life-cover charges"],
    [
      "insurance_health",
      /\b(?:HEALTHCARE|MARKETPLACE|BLUE CROSS|AETNA)\b/i,
      ["health"],
      "health-cover charges",
    ],
    ["insurance_medigap", /\b(?:MEDIGAP|SUPPLEMENT|MEDICARE)\b/i, [], "Medicare cover charges"],
  ] as const) {
    const n = cover(pattern, kinds);
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
    "marketplace_aptc_monthly",
    "marketplace_benchmark_monthly",
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
  return { facts: ordered, today, months, rateMonths: Math.max(1, monthsForRate(txs, today)) };
}
