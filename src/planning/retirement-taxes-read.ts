import { DETECTOR_RATES } from "@/config/detectors";
import { TAXABLE_GAINS_SHARE } from "@/config/retirement-income";
import { IRA_DISTRIBUTION, IRMAA_WATCH, SOCIAL_SECURITY_PAYEE } from "@/config/retirement-taxes";
import { FEDERAL_BRACKETS, STANDARD_DEDUCTION } from "@/config/tax-rates";
import type { Profile, ProfileInput } from "@/profile/build";
import type { Balances } from "./retirement-income";
import {
  irmaaFor,
  socialSecurityTax,
  tunedDraw,
  type Irmaa,
  type SocialSecurityTax,
  type Status,
  type TunedDraw,
} from "./retirement-taxes";
import { marginalRateOf } from "./tax-estimate";

// Taxes on retirement income (spec step 271), read from a person's profile and the rows behind
// it. Pure. The detectors, the chat, its tool and the investing side's retirement paycheck all
// use this one reading.

const T = DETECTOR_RATES.tax;

const PRE_TAX = ["401k", "403b", "457b", "ira", "sep ira", "simple ira"];
const ROTH = ["roth", "roth 401k", "roth ira"];
const TAXABLE = ["brokerage", "stock plan", "mutual fund"];

export type RetirementTaxes = {
  year: number;
  status: Status;
  // On Medicare in the household later (1 or 2).
  people: number;
  // Near Medicare or on it: told 63 or over, or near or in retirement.
  nearMedicare: boolean;
  balances: Balances;
  // A year of each, from the last 12 months of deposits.
  ssBenefitsCents: number;
  ssDeposits: number;
  pensionCents: number;
  iraDrawCents: number;
  // Other income in adjusted gross income (before Social Security's taxable part).
  otherIncomeCents: number;
  ss: SocialSecurityTax;
  // The person's bracket, and the rate on the next pre-tax dollar once Social Security's
  // taxable part growing with it is counted.
  bracket: number;
  nextDollarRate: number;
  magiCents: number;
  irmaa: Irmaa;
  // The step 212 order tuned to stay under the surcharge line, for a year's draw at their pace.
  tuned: TunedDraw;
};

const yearOf = (rows: readonly { amountCents: number }[]) =>
  rows.reduce((s, t) => s - t.amountCents, 0);

export function readRetirementTaxes(profile: Profile, data: ProfileInput): RetirementTaxes {
  const f = profile.facts;
  const year = Number(profile.today.slice(0, 4));
  const status: Status =
    f.household.value === "couple" || f.household.value === "family" ? "married_joint" : "single";
  const since = new Date(Date.parse(profile.today) - 365 * 86_400_000).toISOString().slice(0, 10);
  const recent = data.transactions.filter((t) => t.date > since && t.amountCents < 0);
  const ssRows = recent.filter((t) => SOCIAL_SECURITY_PAYEE.test(t.description));
  const pensionRows = recent.filter((t) => t.pfc === "INCOME_RETIREMENT_PENSION");
  const iraRows = recent.filter((t) => IRA_DISTRIBUTION.test(t.description));
  const ss = yearOf(ssRows);
  const pension = yearOf(pensionRows);
  const ira = yearOf(iraRows);
  // Working income: take-home pay grossed up; retirement income as it arrives.
  const wages =
    f.income_pattern.value === "pension"
      ? 0
      : Math.round(
          (typeof f.monthly_income.value === "number" ? f.monthly_income.value : 0) *
            12 *
            T.netToGross,
        );
  const other = wages + pension + ira;
  const sub = (s: string | null) => (s ?? "").toLowerCase();
  const sum = (kinds: string[]) =>
    data.accounts
      .filter((a) => kinds.includes(sub(a.subtype)))
      .reduce((s, a) => s + a.balanceCents, 0);
  const balances: Balances = {
    taxableCents: sum(TAXABLE),
    preTaxCents: sum(PRE_TAX),
    rothCents: sum(ROTH),
  };
  const people = status === "married_joint" ? 2 : 1;
  const ssTax = socialSecurityTax({ benefitsCents: ss, otherIncomeCents: other, status });
  const magi = other + ssTax.taxableCents;
  const bracket = marginalRateOf(
    Math.max(0, magi - STANDARD_DEDUCTION[status]),
    FEDERAL_BRACKETS[status],
  );
  const age = typeof f.age.value === "number" ? f.age.value : null;
  const stage = f.life_stage.value;
  return {
    year,
    status,
    people,
    nearMedicare:
      age !== null ? age >= IRMAA_WATCH.fromAge : stage === "approaching" || stage === "retired",
    balances,
    ssBenefitsCents: ss,
    ssDeposits: ssRows.length,
    pensionCents: pension,
    iraDrawCents: ira,
    otherIncomeCents: other,
    ss: ssTax,
    bracket,
    nextDollarRate: Math.round(bracket * (1 + ssTax.extraTaxablePerDollar) * 1000) / 1000,
    magiCents: magi,
    irmaa: irmaaFor({ magiCents: magi, status, incomeYear: year, people }),
    tuned: tunedDraw({
      needCents: ira,
      balances,
      otherIncomeCents: wages + pension,
      ssBenefitsCents: ss,
      status,
      incomeYear: year,
      people,
      taxableGainShare: TAXABLE_GAINS_SHARE,
    }),
  };
}
