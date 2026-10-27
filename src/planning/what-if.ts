import {
  SCENARIO_COVER,
  SCENARIO_DEFAULTS,
  SCENARIO_LABELS,
  WHAT_IF_FLOOR_CENTS,
  WHAT_IF_MONTHS,
  type Scenario,
  type ScenarioParams,
} from "@/config/what-if";
import { formatCents } from "@/lib/money";

// What if (spec step 203). Pure: the person's own baseline in, a scenario run month by month
// out. The projection only does the cash arithmetic; every other sector's figure (debt-free
// date, goals, tax, insurance) comes from that sector's own calculation, handed in.

export type WhatIfBaseline = {
  cashCents: number;
  monthlyIncomeCents: number;
  monthlySpendingCents: number;
  // Marginal tax rate on the next dollar (0 to 1), from the tax estimate.
  marginalRate: number | null;
  goals: { id: string; name: string; monthlyNeededCents: number }[];
  // The debt-free month (YYYY-MM) with today's plan and with the scenario's cash flow, each
  // from the debt plan's own calculation. Null for no debts or never.
  debt: { before: string | null; after: string | null; hasDebts: boolean };
};

export type MonthRow = {
  month: number;
  incomeCents: number;
  spendingCents: number;
  balanceCents: number;
};

export type Projection = {
  rows: MonthRow[];
  lowestCents: number;
  // The first month (1-based) cash goes below the floor, or null.
  runsOutMonth: number | null;
  // Monthly income minus spending once the scenario has settled (its last month).
  marginCents: number;
};

export function project(baseline: WhatIfBaseline, params: ScenarioParams): Projection {
  const lasts = params.months > 0 ? params.months : WHAT_IF_MONTHS;
  let balance = baseline.cashCents;
  const rows: MonthRow[] = [];
  let runsOut: number | null = null;
  for (let month = 1; month <= WHAT_IF_MONTHS; month += 1) {
    const changing = month <= lasts;
    const income = Math.round(
      baseline.monthlyIncomeCents * (changing ? 1 - params.incomeLossShare : 1),
    );
    const spending =
      baseline.monthlySpendingCents +
      params.extraMonthlyCents -
      params.savedMonthlyCents +
      (month === 1 ? params.oneTimeCents : 0);
    balance += income - spending;
    if (runsOut === null && balance < WHAT_IF_FLOOR_CENTS) runsOut = month;
    rows.push({ month, incomeCents: income, spendingCents: spending, balanceCents: balance });
  }
  const last = rows[rows.length - 1];
  return {
    rows,
    lowestCents: Math.min(...rows.map((r) => r.balanceCents)),
    runsOutMonth: runsOut,
    marginCents:
      last.incomeCents -
      (baseline.monthlySpendingCents + params.extraMonthlyCents - params.savedMonthlyCents),
  };
}

// The monthly cash flow the debt plan should be run with: today's margin plus what changes.
export function cashFlowChange(baseline: WhatIfBaseline, params: ScenarioParams): number {
  const lasts = params.months > 0 ? params.months : WHAT_IF_MONTHS;
  const incomeChange = -Math.round(baseline.monthlyIncomeCents * params.incomeLossShare);
  // Over the months it lasts; a long change is the whole year's.
  return (
    (lasts >= WHAT_IF_MONTHS ? incomeChange : 0) -
    params.extraMonthlyCents +
    params.savedMonthlyCents
  );
}

export type PlanChange = { key: string; title: string; detail: string };

export type ScenarioRun = {
  scenario: Scenario;
  label: string;
  params: ScenarioParams;
  before: Projection;
  after: Projection;
  sectors: {
    forecast: string;
    goals: { id: string; name: string; status: "fine" | "slips"; note: string }[];
    debt: string | null;
    taxes: string | null;
    insurance: string[];
    investing: string;
  };
  plan: PlanChange[];
};

const BASELINE_PARAMS: ScenarioParams = {
  incomeLossShare: 0,
  months: 0,
  extraMonthlyCents: 0,
  savedMonthlyCents: 0,
  oneTimeCents: 0,
};

const monthName = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export function runScenario(
  scenario: Scenario,
  baseline: WhatIfBaseline,
  overrides: Partial<ScenarioParams> = {},
): ScenarioRun {
  const params = { ...SCENARIO_DEFAULTS[scenario], ...overrides };
  const before = project(baseline, BASELINE_PARAMS);
  const after = project(baseline, params);

  const forecast =
    after.runsOutMonth !== null
      ? `Cash runs out in month ${after.runsOutMonth}; the lowest it gets is ${formatCents(after.lowestCents)}.`
      : `Cash stays above zero for the year; the lowest it gets is ${formatCents(after.lowestCents)}.`;

  // A goal slips when its monthly need no longer fits in what's left each month.
  const room = Math.max(0, after.marginCents);
  const totalNeeded = baseline.goals.reduce((s, g) => s + g.monthlyNeededCents, 0);
  const goals = baseline.goals.map((g) => {
    const slips = after.runsOutMonth !== null || totalNeeded > room;
    return {
      id: g.id,
      name: g.name,
      status: slips ? ("slips" as const) : ("fine" as const),
      note: slips
        ? `${formatCents(g.monthlyNeededCents)} a month no longer fits; its date would need to move.`
        : `${formatCents(g.monthlyNeededCents)} a month still fits.`,
    };
  });

  const debt = !baseline.debt.hasDebts
    ? null
    : baseline.debt.before === baseline.debt.after
      ? `Debt-free in ${baseline.debt.after ? monthName(baseline.debt.after) : "no set month"}, no change.`
      : `Debt-free moves from ${baseline.debt.before ? monthName(baseline.debt.before) : "no set month"} to ${baseline.debt.after ? monthName(baseline.debt.after) : "no set month"}.`;

  const yearlyIncomeChange = Math.round(
    -baseline.monthlyIncomeCents *
      params.incomeLossShare *
      (params.months > 0 ? params.months : 12),
  );
  const taxes =
    baseline.marginalRate === null || params.incomeLossShare === 0
      ? null
      : `About ${formatCents(Math.abs(Math.round(yearlyIncomeChange * baseline.marginalRate)))} ${yearlyIncomeChange < 0 ? "less" : "more"} in tax for the year, at your ${Math.round(baseline.marginalRate * 100)}% rate on the next dollar.`;

  const investing =
    room > 0
      ? `${formatCents(room)} a month left over for investing once things settle.`
      : "Nothing left over for investing while this lasts.";

  const plan: PlanChange[] = [];
  if (after.runsOutMonth !== null || after.marginCents < 0) {
    plan.push({
      key: "pause-extra",
      title: "Pause extra debt payments and pause moving money to goals",
      detail: "Keep the minimums; pick it back up when the margin returns.",
    });
    plan.push({
      key: "trim",
      title: `Trim spending by ${formatCents(Math.max(0, -after.marginCents))} a month`,
      detail: "That is how far spending sits above what comes in once this settles.",
    });
  }
  for (const g of goals.filter((x) => x.status === "slips")) {
    plan.push({ key: `goal:${g.id}`, title: `Move the date on "${g.name}"`, detail: g.note });
  }
  if (params.oneTimeCents > 0) {
    plan.push({
      key: "save-first",
      title: `Set aside ${formatCents(params.oneTimeCents)} before it's due`,
      detail: "The one-time cost comes out of cash in the first month.",
    });
  }
  for (const line of SCENARIO_COVER[scenario]) {
    plan.push({ key: `cover:${plan.length}`, title: "Check your cover", detail: line });
  }

  return {
    scenario,
    label: SCENARIO_LABELS[scenario],
    params,
    before,
    after,
    sectors: { forecast, goals, debt, taxes, insurance: SCENARIO_COVER[scenario], investing },
    plan,
  };
}
