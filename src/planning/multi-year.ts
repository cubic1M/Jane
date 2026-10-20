import {
  DEFAULT_YEARS_TO_RETIREMENT,
  MAX_PROJECTION_YEARS,
  MIN_CONVERSION_CENTS,
  MOVE_MIN_CENTS,
  PROJECTION_YEARS,
  RETIREMENT_GROWTH_RATE,
  WAGE_GROWTH_RATE,
  WITHDRAWAL_YEARS,
  indexFactor,
  type PlannedEventKind,
} from "@/config/tax-years";
import { CAPITAL_GAINS_BRACKETS, FEDERAL_BRACKETS } from "@/config/tax-rates";
import { estimateTaxes, type EstimateInput } from "@/planning/tax-estimate";

// Tax moves over several years (spec step 220). Pure. A projection of the federal tax for
// each year from the start year's estimate (step 120) and the plans of every sector: pay
// grows until retirement, a traditional retirement account is withdrawn from then, the
// investments' long-term gains are assumed realised at retirement. A year's brackets are
// 2026's scaled by that year's factor (src/config/tax-years.ts): income is deflated, taxed
// with the 2026 engine, and the tax inflated back. The first year is the estimate itself.
//
// The moves are changes to that plan; each one's effect is the tax over all the years with
// it against without it.

export type PlannedEvent = {
  id: string;
  kind: PlannedEventKind;
  year: number;
  amountCents: number;
};

export type Plan = {
  startYear: number;
  // The start year's estimate input, as the estimate was worked out.
  base: EstimateInput;
  retireYear: number | null;
  traditionalCents: number;
  unrealisedLongTermCents: number;
  events: PlannedEvent[];
};

// What a move changes.
export type Adjust = {
  // Roth conversions by year (cents): taxed as ordinary income that year, off the account.
  conversions?: Record<number, number>;
  // Long-term gains realised early by year, taken off the sale at retirement.
  harvested?: Record<number, number>;
  // A year's charity gifts, replacing the usual.
  charity?: Record<number, number>;
  // Planned events moved: id -> the year it happens instead.
  moved?: Record<string, number>;
};

export const retireYearOf = (plan: Plan) =>
  plan.retireYear ?? plan.startYear + DEFAULT_YEARS_TO_RETIREMENT;

export function horizon(plan: Plan): number {
  const needed = retireYearOf(plan) + WITHDRAWAL_YEARS - plan.startYear;
  return Math.min(MAX_PROJECTION_YEARS, Math.max(PROJECTION_YEARS, needed));
}

const grow = (cents: number, rate: number, years: number) =>
  cents * (1 + rate) ** Math.max(0, years);
const scale = (x: number, by: number) => Math.round(x * by);

// The retirement account's balance at retirement, after conversions.
function balanceAtRetirement(plan: Plan, adj: Adjust): number {
  const retire = retireYearOf(plan);
  let balance = grow(plan.traditionalCents, RETIREMENT_GROWTH_RATE, retire - plan.startYear);
  for (const [y, a] of Object.entries(adj.conversions ?? {})) {
    balance -= grow(a, RETIREMENT_GROWTH_RATE, retire - Number(y));
  }
  return Math.max(0, balance);
}

// The year's input in that year's dollars (nominal): pay, withdrawals, planned events and
// the moves applied.
export function inputFor(plan: Plan, year: number, adj: Adjust = {}): EstimateInput {
  const b = plan.base;
  const k = year - plan.startYear;
  const retire = retireYearOf(plan);
  const working = k === 0 || year < retire;
  const wageFactor = (1 + WAGE_GROWTH_RATE) ** k;
  let wages = working ? scale(b.income.wagesCents, wageFactor) : 0;
  const ssWages = working ? scale(b.income.socialSecurityWagesCents, wageFactor) : 0;
  let retirement = b.income.retirementCents;
  let longTerm = k === 0 ? b.income.longTermGainsCents : 0;
  const shortTerm = k === 0 ? b.income.shortTermGainsCents : 0;
  for (const e of plan.events) {
    const at = adj.moved?.[e.id] ?? e.year;
    if (at !== year) continue;
    if (e.kind === "bonus") wages += e.amountCents;
    else if (e.kind === "sale") longTerm += e.amountCents;
    else retirement += e.amountCents;
  }
  // Retirement withdrawals, level over WITHDRAWAL_YEARS.
  if (year >= retire && year < retire + WITHDRAWAL_YEARS) {
    retirement += Math.round(balanceAtRetirement(plan, adj) / WITHDRAWAL_YEARS);
  }
  retirement += adj.conversions?.[year] ?? 0;
  // The investments' long-term gains are assumed realised in the retirement year, less
  // what was harvested early.
  const harvestedTotal = Object.values(adj.harvested ?? {}).reduce((s, a) => s + a, 0);
  if (year === retire) longTerm += Math.max(0, plan.unrealisedLongTermCents - harvestedTotal);
  longTerm += adj.harvested?.[year] ?? 0;
  return {
    ...b,
    year,
    income: {
      ...b.income,
      wagesCents: wages,
      socialSecurityWagesCents: ssWages,
      retirementCents: retirement,
      longTermGainsCents: longTerm,
      shortTermGainsCents: shortTerm,
      qualifiedDividendsCents: b.income.qualifiedDividendsCents,
      unemploymentCents: k === 0 ? b.income.unemploymentCents : 0,
    },
    charityCents: adj.charity?.[year] ?? b.charityCents,
    federalWithheldCents: k === 0 ? b.federalWithheldCents : 0,
    federalEstimatedPaidCents: k === 0 ? b.federalEstimatedPaidCents : 0,
    stateWithheldCents: k === 0 ? b.stateWithheldCents : 0,
    stateEstimatedPaidCents: k === 0 ? b.stateEstimatedPaidCents : 0,
    amtPreferenceCents: k === 0 ? b.amtPreferenceCents : 0,
  };
}

const DEFLATED_KEYS = [
  "wagesCents",
  "socialSecurityWagesCents",
  "selfEmploymentCents",
  "interestCents",
  "dividendsCents",
  "qualifiedDividendsCents",
  "shortTermGainsCents",
  "longTermGainsCents",
  "rentalCents",
  "retirementCents",
  "unemploymentCents",
  "otherCents",
] as const;

export type YearTax = {
  year: number;
  factor: number;
  // In that year's dollars.
  incomeCents: number;
  taxableCents: number;
  totalTaxCents: number;
  marginalRate: number;
  // Room left in the 12% bracket and the 0% capital gains bracket, that year's dollars.
  headroom12Cents: number;
  headroom0LtcgCents: number;
};

// A year's federal tax: deflate to 2026 dollars, tax with the 2026 engine, inflate back.
// The start year is the estimate as it stands.
export function taxFor(plan: Plan, year: number, adj: Adjust = {}): YearTax {
  const input = inputFor(plan, year, adj);
  const f = year === plan.startYear ? 1 : indexFactor(year) / indexFactor(plan.startYear);
  const deflated: EstimateInput =
    f === 1
      ? input
      : {
          ...input,
          mortgageInterestCents: scale(input.mortgageInterestCents, 1 / f),
          charityCents: scale(input.charityCents, 1 / f),
          medicalCents: scale(input.medicalCents, 1 / f),
          studentLoanInterestCents: scale(input.studentLoanInterestCents, 1 / f),
          otherStateLocalTaxCents: scale(input.otherStateLocalTaxCents, 1 / f),
          income: Object.fromEntries(
            Object.entries(input.income).map(([k, v]) => [
              k,
              (DEFLATED_KEYS as readonly string[]).includes(k) && typeof v === "number"
                ? scale(v, 1 / f)
                : v,
            ]),
          ) as EstimateInput["income"],
        };
  const e = estimateTaxes(deflated);
  const status = input.filingStatus;
  const top12 = FEDERAL_BRACKETS[status].find((b) => b.rate === 0.22)?.over ?? 0;
  const zeroLtcg = CAPITAL_GAINS_BRACKETS[status][1]?.over ?? 0;
  // Start-year figures are in the estimate's own dollars (factor 1 against the scale).
  const unit = year === plan.startYear ? 1 : f;
  return {
    year,
    factor: unit,
    incomeCents: scale(e.totalIncomeCents, unit),
    taxableCents: scale(e.taxableCents, unit),
    totalTaxCents: scale(e.totalTaxCents, unit),
    marginalRate: e.marginalRate,
    headroom12Cents: Math.max(0, scale(top12 - e.taxableCents, unit)),
    headroom0LtcgCents: Math.max(0, scale(zeroLtcg - e.taxableCents, unit)),
  };
}

export function project(plan: Plan, adj: Adjust = {}): YearTax[] {
  return Array.from({ length: horizon(plan) }, (_, i) => taxFor(plan, plan.startYear + i, adj));
}

const lifetime = (rows: YearTax[]) => rows.reduce((s, r) => s + r.totalTaxCents, 0);

export type Move = {
  key: string;
  kind: "roth" | "gains" | "bunch" | "timing";
  title: string;
  why: string;
  // The year to act in, and (timing) the year it moves from.
  year: number;
  fromYear: number | null;
  amountCents: number;
  // Tax saved over all the years, with the move against without it.
  effectCents: number;
  adjust: Adjust;
};

const dollars = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function findMoves(plan: Plan, base = project(plan)): Move[] {
  const moves: Move[] = [];
  const total = lifetime(base);
  const effect = (adj: Adjust) => total - lifetime(project(plan, adj));
  const retire = retireYearOf(plan);

  // Roth conversions in years with room in the 12% bracket, before the withdrawals start.
  if (plan.traditionalCents > 0) {
    const cands: Move[] = [];
    for (const row of base) {
      if (row.year >= retire + WITHDRAWAL_YEARS) continue;
      const balance = grow(
        plan.traditionalCents,
        RETIREMENT_GROWTH_RATE,
        row.year - plan.startYear,
      );
      const amount = Math.round(Math.min(row.headroom12Cents, balance));
      if (amount < MIN_CONVERSION_CENTS) continue;
      const adjust: Adjust = { conversions: { [row.year]: amount } };
      const e = effect(adjust);
      if (e >= MOVE_MIN_CENTS) {
        cands.push({
          key: `roth:${row.year}`,
          kind: "roth",
          title: `Convert ${dollars(amount)} to a Roth IRA in ${row.year}`,
          why: `${row.year} has room in the 12% bracket (${dollars(row.headroom12Cents)} left). Converting now is taxed at the low rate; the same money would be taxed later at a higher one when you withdraw it.`,
          year: row.year,
          fromYear: null,
          amountCents: amount,
          effectCents: e,
          adjust,
        });
      }
    }
    moves.push(...cands.sort((a, b) => b.effectCents - a.effectCents).slice(0, 2));
  }

  // Filling the 0% capital gains bracket with gains that would be taxed later.
  if (plan.unrealisedLongTermCents > 0) {
    const cands: Move[] = [];
    for (const row of base) {
      const amount = Math.round(Math.min(row.headroom0LtcgCents, plan.unrealisedLongTermCents));
      if (amount < MIN_CONVERSION_CENTS) continue;
      const adjust: Adjust = { harvested: { [row.year]: amount } };
      const e = effect(adjust);
      if (e >= MOVE_MIN_CENTS) {
        cands.push({
          key: `gains:${row.year}`,
          kind: "gains",
          title: `Realise ${dollars(amount)} of long-term gains in ${row.year}`,
          why: `${row.year}'s taxable income leaves ${dollars(row.headroom0LtcgCents)} in the 0% capital gains bracket. Selling and rebuying (no wash-sale rule for gains) raises the cost basis tax-free; waiting would tax those gains later.`,
          year: row.year,
          fromYear: null,
          amountCents: amount,
          effectCents: e,
          adjust,
        });
      }
    }
    moves.push(...cands.sort((a, b) => b.effectCents - a.effectCents).slice(0, 1));
  }

  // Bunching two years of gifts into one, alternating years.
  const gift = plan.base.charityCents;
  if (gift > 0) {
    let best: Move | null = null;
    for (const row of base.slice(0, -1)) {
      const g = Math.round(gift * (indexFactor(row.year) / indexFactor(plan.startYear)));
      const adjust: Adjust = { charity: { [row.year]: g * 2, [row.year + 1]: 0 } };
      const e = effect(adjust);
      if (e >= MOVE_MIN_CENTS && (!best || e > best.effectCents)) {
        best = {
          key: `bunch:${row.year}`,
          kind: "bunch",
          title: `Give ${row.year + 1}'s gifts in ${row.year} too`,
          why: `Gifts only lower your tax once your deductions pass the standard deduction. Giving two years' worth in ${row.year} and none in ${row.year + 1} can get over it in the year you give.`,
          year: row.year,
          fromYear: row.year + 1,
          amountCents: g,
          effectCents: e,
          adjust,
        };
      }
    }
    if (best) moves.push(best);
  }

  // Timing a bonus, a sale or a retirement withdrawal the person is planning.
  for (const ev of plan.events) {
    let best: Move | null = null;
    for (const row of base) {
      if (row.year === ev.year) continue;
      const adjust: Adjust = { moved: { [ev.id]: row.year } };
      const e = effect(adjust);
      if (e >= MOVE_MIN_CENTS && (!best || e > best.effectCents)) {
        const noun =
          ev.kind === "bonus" ? "your bonus" : ev.kind === "sale" ? "your sale" : "your withdrawal";
        best = {
          key: `timing:${ev.id}:${row.year}`,
          kind: "timing",
          title: `Take ${noun} of ${dollars(ev.amountCents)} in ${row.year}, not ${ev.year}`,
          why: `${row.year} is a lower-tax year for it than ${ev.year}.`,
          year: row.year,
          fromYear: ev.year,
          amountCents: ev.amountCents,
          effectCents: e,
          adjust,
        };
      }
    }
    if (best) moves.push(best);
  }
  return moves.sort((a, b) => b.effectCents - a.effectCents);
}

export const lifetimeTax = lifetime;
