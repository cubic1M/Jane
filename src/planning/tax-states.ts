import type { FilingStatus } from "@/config/tax";
import { STANDARD_DEDUCTION, STATE_TAX, type StateTax } from "@/config/tax-rates";
import { CONVENIENCE_RULE_STATES, LOCAL_TAXES, STATE_SOURCES } from "@/config/tax-states";
import { bracketTax } from "@/planning/tax-brackets";
import { DAY_MS } from "@/lib/dates";

// State and local income taxes (spec step 165). Pure. One state all year is the simple
// case; a move splits the year, and remote work for an employer in another state can mean
// two states tax the same wages. Jane works each state the way most part-year and
// nonresident returns do: the tax on all the income as if a resident all year, times the
// share of the income that state taxes. Wages go to the state lived in on each payday (the
// paydays still to come to wherever the person lives then); other income by days lived
// there. A state that taxes income another state taxes too (the home state for remote work
// in a "convenience of the employer" state) gives a credit for the other state's tax, up to
// its own tax on that income.

export type Move = { date: string; from: string; to: string };

export type Residency = {
  // Moves in the year, any order.
  moves: Move[];
  // The employer's state, for someone working from home for an employer in another state.
  workState: string | null;
  // A LOCAL_TAXES key: the city or county the person lives in, if it has an income tax.
  locality: string | null;
  // Wages paid on each payday so far, to split wages by where the person lived.
  paydays?: { date: string; cents: number }[];
};

export type ResidencePeriod = { state: string; from: string; to: string; days: number };

export type StateRuleInput = {
  filingStatus: FilingStatus;
  childrenUnder17: number;
  otherDependants: number;
};

export type StatePart = {
  code: string;
  residence: "full_year" | "part_year" | "nonresident";
  // The dates lived there in the year (null for a nonresident state).
  from: string | null;
  to: string | null;
  kind: StateTax["kind"];
  // The income this state taxes, and its share of all income.
  incomeCents: number;
  share: number;
  // The tax as if a resident all year, then this state's share, less the credit.
  fullYearTaxCents: number;
  creditCents: number;
  taxCents: number;
  source: string;
  url: string | null;
  rough: boolean;
};

export type LocalPart = {
  key: string;
  label: string;
  state: string;
  taxCents: number;
  source: string;
  url: string;
};

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const isoOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const clamp0 = (n: number) => Math.max(0, n);

// The stretches of the year lived in each state, from the moves in it (a move on a date
// means living in the new state from that day). Without moves, the whole year in `state`.
export function residencePeriods(
  year: number,
  state: string | null,
  moves: Move[],
): ResidencePeriod[] {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const inYear = moves
    .filter((m) => m.date > start && m.date <= end && m.from !== m.to)
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = inYear[0]?.from ?? state;
  if (!first) return [];
  const periods: ResidencePeriod[] = [];
  let from = start;
  let current = first;
  for (const m of inYear) {
    const to = isoOf(dayNumber(m.date) - 1);
    periods.push({ state: current, from, to, days: dayNumber(to) - dayNumber(from) + 1 });
    from = m.date;
    current = m.to;
  }
  periods.push({ state: current, from, to: end, days: dayNumber(end) - dayNumber(from) + 1 });
  return periods;
}

const periodOf = (periods: ResidencePeriod[], date: string) =>
  periods.find((p) => date >= p.from && date <= p.to) ?? null;

// Each period's wages: each payday's pay goes where the person lived when paid. The paydays
// seen cover the year up to one pay period after the last; the rest of the year's projected
// wages go by days lived in each state after that.
export function wagesByPeriod(
  periods: ResidencePeriod[],
  wagesCents: number,
  paydays: { date: string; cents: number }[],
): number[] {
  if (periods.length === 0) return [];
  const start = dayNumber(periods[0].from);
  const end = dayNumber(periods.at(-1)!.to);
  const seen = paydays
    .filter((p) => p.cents > 0 && dayNumber(p.date) >= start && dayNumber(p.date) <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
  const paid = seen.reduce((s, p) => s + p.cents, 0);
  const out = periods.map(() => 0);
  let coveredTo = start - 1;
  if (paid > 0) {
    const days = seen.map((p) => dayNumber(p.date));
    const gaps = days
      .slice(1)
      .map((d, i) => d - days[i])
      .sort((a, b) => a - b);
    const period = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : days[0] - start + 1;
    coveredTo = Math.min(end, days.at(-1)! + period - 1);
    const covered = (wagesCents * (coveredTo - start + 1)) / (end - start + 1);
    for (const p of seen) {
      const i = periods.indexOf(periodOf(periods, p.date)!);
      out[i] += (p.cents / paid) * covered;
    }
  }
  const rest = wagesCents - out.reduce((a, b) => a + b, 0);
  if (rest > 0) {
    const daysLeft = periods.map((p) =>
      Math.max(0, dayNumber(p.to) - Math.max(dayNumber(p.from), coveredTo + 1) + 1),
    );
    const total = daysLeft.reduce((a, b) => a + b, 0);
    daysLeft.forEach((d, i) => {
      out[i] += total > 0 ? (rest * d) / total : rest / periods.length;
    });
  }
  return out.map(Math.round);
}

// One state's tax on an income as if a resident all year, by its kind of schedule.
export function residentTax(
  code: string,
  incomeCents: number,
  who: StateRuleInput,
): { rules: StateTax; taxableCents: number; taxCents: number; rough: boolean } | null {
  const rules = STATE_TAX[code];
  if (!rules) return null;
  switch (rules.kind) {
    case "none":
      return { rules, taxableCents: 0, taxCents: 0, rough: false };
    case "flat": {
      const taxable = clamp0(incomeCents - rules.deduction);
      return {
        rules,
        taxableCents: taxable,
        taxCents: Math.round(taxable * rules.rate),
        rough: Boolean(rules.estimate),
      };
    }
    case "approximate": {
      const taxable = clamp0(incomeCents - STANDARD_DEDUCTION[who.filingStatus]);
      return {
        rules,
        taxableCents: taxable,
        taxCents: Math.round(taxable * rules.rate),
        rough: true,
      };
    }
    case "brackets": {
      const taxable = clamp0(incomeCents - rules.deduction[who.filingStatus]);
      const credits =
        rules.personalCredit[who.filingStatus] +
        (who.childrenUnder17 + who.otherDependants) * rules.dependantCredit;
      return {
        rules,
        taxableCents: taxable,
        taxCents: clamp0(bracketTax(taxable, rules.brackets[who.filingStatus]) - credits),
        rough: Boolean(rules.estimate),
      };
    }
  }
}

export const workStateTaxesRemoteWages = (workState: string | null, home: string) =>
  workState !== null && workState !== home && CONVENIENCE_RULE_STATES.includes(workState);

// Every state that taxes some of the year's income, with its tax after credits, and the
// local tax. `agiCents` is the federal AGI; `wagesCents` the wages in it.
export function stateParts(input: {
  year: number;
  state: string | null;
  residency: Residency | undefined;
  who: StateRuleInput;
  agiCents: number;
  wagesCents: number;
}): { parts: StatePart[]; local: LocalPart | null } {
  const r = input.residency;
  const periods = residencePeriods(input.year, input.state, r?.moves ?? []);
  const known = periods.filter((p) => STATE_TAX[p.state]);
  if (known.length === 0) return { parts: [], local: null };
  const totalDays = periods.reduce((s, p) => s + p.days, 0);
  const agi = clamp0(input.agiCents);
  const wages = Math.min(clamp0(input.wagesCents), agi);
  const other = agi - wages;
  const wageSplit = wagesByPeriod(periods, wages, r?.paydays ?? []);

  // Resident states: their wages and their days' share of other income.
  const byState = new Map<string, { income: number; wages: number; periods: ResidencePeriod[] }>();
  periods.forEach((p, i) => {
    const s = byState.get(p.state) ?? { income: 0, wages: 0, periods: [] };
    s.wages += wageSplit[i];
    s.income += wageSplit[i] + Math.round((other * p.days) / totalDays);
    s.periods.push(p);
    byState.set(p.state, s);
  });

  // A convenience-rule work state taxes the wages earned while living elsewhere.
  const work = r?.workState ?? null;
  const remote =
    work && STATE_TAX[work]
      ? periods.reduce(
          (sum, p, i) => sum + (workStateTaxesRemoteWages(work, p.state) ? wageSplit[i] : 0),
          0,
        )
      : 0;

  const part = (
    code: string,
    income: number,
    residence: StatePart["residence"],
    from: string | null,
    to: string | null,
  ): StatePart => {
    const full = residentTax(code, agi, input.who)!;
    const share = agi > 0 ? Math.min(1, income / agi) : residence === "full_year" ? 1 : 0;
    const src = STATE_SOURCES[code];
    return {
      code,
      residence,
      from,
      to,
      kind: full.rules.kind,
      incomeCents: income,
      share,
      fullYearTaxCents: full.taxCents,
      creditCents: 0,
      taxCents: Math.round(full.taxCents * share),
      source: full.rules.source,
      url: src?.url ?? null,
      rough: full.rough,
    };
  };

  const parts: StatePart[] = [...byState.entries()]
    .filter(([code]) => STATE_TAX[code])
    .map(([code, s]) =>
      part(
        code,
        s.income,
        periods.length === 1 ? "full_year" : "part_year",
        s.periods[0].from,
        s.periods.at(-1)!.to,
      ),
    );

  if (remote > 0 && work) {
    const existing = parts.find((p) => p.code === work);
    const workPart = existing ?? part(work, 0, "nonresident", null, null);
    if (!existing) parts.push(workPart);
    workPart.incomeCents += remote;
    workPart.share = agi > 0 ? Math.min(1, workPart.incomeCents / agi) : 0;
    workPart.taxCents = Math.round(workPart.fullYearTaxCents * workPart.share);
    // The work state's tax on the remote wages, credited by the home states they were
    // earned in, each up to its own tax on them.
    const workTaxOnRemote = agi > 0 ? (workPart.fullYearTaxCents * remote) / agi : 0;
    for (const p of parts) {
      if (p.code === work) continue;
      const theirRemote = periods.reduce(
        (sum, per, i) =>
          sum +
          (per.state === p.code && workStateTaxesRemoteWages(work, per.state) ? wageSplit[i] : 0),
        0,
      );
      if (theirRemote === 0) continue;
      const ownOnIt = agi > 0 ? (p.fullYearTaxCents * theirRemote) / agi : 0;
      const credit = Math.round(Math.min(ownOnIt, (workTaxOnRemote * theirRemote) / remote));
      p.creditCents = Math.min(credit, p.taxCents);
      p.taxCents -= p.creditCents;
    }
  }

  return { parts, local: localTax(r?.locality ?? null, parts, byState, input.who, agi) };
}

function localTax(
  key: string | null,
  parts: StatePart[],
  byState: Map<string, { income: number; wages: number; periods: ResidencePeriod[] }>,
  who: StateRuleInput,
  agi: number,
): LocalPart | null {
  const local = key ? LOCAL_TAXES[key] : undefined;
  if (!key || !local) return null;
  const home = byState.get(local.state);
  const statePart = parts.find((p) => p.code === local.state);
  if (!home || !statePart || statePart.residence === "nonresident") return null;
  let tax = 0;
  if (local.base === "wages") {
    tax = home.wages * (local.rate ?? 0);
  } else if (local.base === "state_tax") {
    tax = (statePart.taxCents + statePart.creditCents) * (local.rate ?? 0);
  } else {
    const taxable = residentTax(local.state, agi, who)?.taxableCents ?? 0;
    const full = local.brackets ? bracketTax(taxable, local.brackets) : taxable * (local.rate ?? 0);
    tax = full * statePart.share;
  }
  return {
    key,
    label: local.label,
    state: local.state,
    taxCents: Math.round(tax),
    source: local.source,
    url: local.url,
  };
}

// A move Jane can see: payments to a state's agencies (a DMV, a tax department, named with
// the state's code first, like "CA DMV") switching to another state in the year. The move
// date is the first payment in the new state; only when the latest payment is there too.
export function spotMove(
  year: number,
  payments: { date: string; description: string }[],
  isState: (code: string) => boolean,
): Move | null {
  const seen = payments
    .filter((p) => p.date.startsWith(String(year)) && /^[A-Z]{2} /.test(p.description))
    .map((p) => ({ date: p.date, state: p.description.slice(0, 2) }))
    .filter((p) => isState(p.state))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (seen.length < 2) return null;
  const first = seen[0].state;
  const switched = seen.find((p) => p.state !== first);
  if (!switched || seen.at(-1)!.state !== switched.state) return null;
  return { date: switched.date, from: first, to: switched.state };
}

// The city and county income taxes in a state, for the "do you live in…" question.
export const localitiesIn = (state: string | null) =>
  Object.entries(LOCAL_TAXES)
    .filter(([, l]) => l.state === state)
    .map(([key, l]) => ({ key, label: l.label }));
