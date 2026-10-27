import {
  SCENARIOS,
  SCENARIO_LABELS,
  WHAT_IF_MAX_MONTHS,
  type Scenario,
  type ScenarioParams,
} from "@/config/what-if";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import type { DetectionInput } from "@/detection/types";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { loadPayoff } from "@/lib/debt-plan";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { listGoals } from "@/lib/goals";
import { healthInput } from "@/lib/health-score";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import {
  cashFlowChange,
  runScenario,
  type PlanChange,
  type ScenarioRun,
  type WhatIfBaseline,
} from "@/planning/what-if";

// What if (spec step 203): a scenario run through every sector's own numbers. The cash
// baseline is the health score's (the same averages), debts come from the debt plan, goals
// from the goals list and the tax rate from the tax estimate. Running it changes nothing;
// adopting it saves the plan's changes, which then show among the next best things.

type Options = { client?: PrismaClient; now?: Date; input?: DetectionInput };

export const isScenario = (value: unknown): value is Scenario =>
  (SCENARIOS as readonly unknown[]).includes(value);

export async function loadBaseline(
  userId: string,
  { client = defaultClient, now = new Date(), input: given }: Options = {},
): Promise<WhatIfBaseline | null> {
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  if (input.accounts.length === 0) return null;
  const [health, goals, payoff, tax] = await Promise.all([
    healthInput(userId, input, { client, now }),
    listGoals(userId, { client, now }),
    loadPayoff(userId, { client, now }),
    loadTaxEstimate(userId, { client, now })
      .then((t) => t.estimate.marginalRate)
      .catch(() => null),
  ]);
  return {
    cashCents: health.cashCents ?? 0,
    monthlyIncomeCents: health.monthlyIncomeCents ?? 0,
    monthlySpendingCents: health.monthlySpendingCents ?? 0,
    marginalRate: tax,
    goals: goals.flatMap((g) =>
      g.progress.status === "on_the_way"
        ? [{ id: g.id, name: g.name, monthlyNeededCents: g.progress.monthlyCents }]
        : [],
    ),
    debt: {
      hasDebts: payoff.book.debts.length > 0,
      before: payoff.debtFreeMonth,
      after: payoff.debtFreeMonth,
    },
  };
}

// The scenario's run. The debt-free month with the changed cash flow is the debt plan's own
// calculation, with the extra payment it can still afford.
export async function whatIf(
  userId: string,
  scenario: Scenario,
  overrides: { months?: number; extraMonthlyCents?: number } = {},
  { client = defaultClient, now = new Date(), input }: Options = {},
): Promise<ScenarioRun | null> {
  const baseline = await loadBaseline(userId, { client, now, input });
  if (!baseline) return null;
  const clean: Partial<ScenarioParams> = {};
  if (overrides.months !== undefined) {
    clean.months = Math.min(WHAT_IF_MAX_MONTHS, Math.max(0, Math.round(overrides.months)));
  }
  if (overrides.extraMonthlyCents !== undefined) {
    clean.extraMonthlyCents = Math.max(0, Math.round(overrides.extraMonthlyCents));
  }
  const first = runScenario(scenario, baseline, clean);
  if (baseline.debt.hasDebts) {
    const payoff = await loadPayoff(userId, { client, now });
    const extra = Math.max(
      0,
      (payoff.stored?.extraCents ?? 0) + cashFlowChange(baseline, first.params),
    );
    const after = await loadPayoff(userId, { client, now, extraCents: extra });
    baseline.debt.after = after.debtFreeMonth;
    return runScenario(scenario, baseline, clean);
  }
  return first;
}

export type AdoptedPlan = {
  id: string;
  scenario: Scenario;
  label: string;
  changes: PlanChange[];
  createdAt: Date;
};

// "Use this plan": saved as the next best things, nothing done. One open plan per scenario.
export async function adoptPlan(
  userId: string,
  run: ScenarioRun,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string> {
  const db = scopedFor(userId, client);
  await db.whatIfPlans.updateMany({
    where: { scenario: run.scenario, status: "adopted" },
    data: { status: "dropped" },
  });
  const row = await db.whatIfPlans.create({
    data: {
      userId,
      scenario: run.scenario,
      params: run.params as unknown as Prisma.InputJsonObject,
      changes: run.plan as unknown as Prisma.InputJsonArray,
      createdAt: now,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "what_if_adopted",
    { type: "what_if_plan", id: row.id },
    { scenario: run.scenario },
  );
  await track(userId, "what_if_adopted", { scenario: run.scenario });
  return row.id;
}

export async function adoptedPlans(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<AdoptedPlan[]> {
  const rows = await scopedFor(userId, client).whatIfPlans.findMany({
    where: { status: "adopted" },
    orderBy: { createdAt: "desc" },
    select: { id: true, scenario: true, changes: true, createdAt: true },
  });
  return rows.flatMap((r) =>
    isScenario(r.scenario) && Array.isArray(r.changes)
      ? [
          {
            id: r.id,
            scenario: r.scenario,
            label: SCENARIO_LABELS[r.scenario],
            changes: r.changes as unknown as PlanChange[],
            createdAt: r.createdAt,
          },
        ]
      : [],
  );
}
