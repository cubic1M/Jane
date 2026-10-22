import { GOAL_ORDER_FACT } from "@/config/tradeoffs";
import type { DetectionInput } from "@/detection/types";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { listGoals, type GoalView } from "@/lib/goals";
import { listPreferences, savePreference, type Preference } from "@/lib/jane-agent/preferences";
import { loadYearPlan } from "@/lib/year-plan";
import {
  fund,
  roomFromPlan,
  parseGoalOrder,
  tradeGoalOf,
  tradeoffs,
  type TradeOrder,
  type Tradeoffs,
} from "@/planning/goal-tradeoffs";

// Goals that trade off openly (spec step 241). When the goals together need more each month
// than the year plan (step 205) has room for, this works out each order's dates from that
// plan, Jane's suggested order and why, and keeps the person's pick. The pick is the order
// every sector funds goals in (listGoals reads it: the paycheck plan, the year plan, the goals
// page); nothing re-plans without the person's tap.

type Options = { client?: PrismaClient; now?: Date; input?: DetectionInput };

export class TradeoffError extends Error {}

export type TradeoffView = Tradeoffs & {
  startMonth: string;
  // The order the person picked (goal ids, first first), or null.
  chosen: string[] | null;
  // Each goal's dates under the order in force (the pick, or by date).
  current: TradeOrder | null;
};

// The person's pick, from their remembered facts.
export function goalOrderOf(prefs: readonly Preference[]): string[] | null {
  const fact = prefs.find((p) => p.kind === "fact" && p.key === GOAL_ORDER_FACT);
  return parseGoalOrder(fact?.value.order);
}

export async function loadTradeoffs(
  userId: string,
  { client = defaultClient, now = new Date(), input }: Options = {},
): Promise<TradeoffView | null> {
  const [goals, plan, prefs] = await Promise.all([
    listGoals(userId, { client, now }),
    loadYearPlan(userId, { client, now, input }),
    listPreferences(userId, { client }),
  ]);
  if (!plan) return null;
  const startMonth = now.toISOString().slice(0, 7);
  const open = goals.flatMap((g) => tradeGoalOf(g) ?? []);
  const capacity = roomFromPlan(plan.months, startMonth);
  const view = tradeoffs(open, capacity, startMonth);
  const chosen = goalOrderOf(prefs);
  // listGoals already puts the goals in the order in force.
  const current =
    open.length > 0
      ? fund(
          open,
          open.map((g) => g.id),
          capacity,
          startMonth,
        )
      : null;
  return { ...view, startMonth, chosen, current };
}

// The person's tap: the goals in this order from now on, everywhere.
export async function chooseGoalOrder(
  userId: string,
  order: readonly string[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ order: string[]; names: string[] }> {
  const goals = await listGoals(userId, { client, now });
  const byId = new Map(goals.map((g) => [g.id, g]));
  const ids = [...new Set(order)].filter((id) => byId.has(id));
  if (ids.length < 2) throw new TradeoffError("Pick an order for at least two of your goals.");
  // Goals not named keep their place after the ones that were.
  const full = [...ids, ...goals.map((g) => g.id).filter((id) => !ids.includes(id))];
  const names = full.map((id) => (byId.get(id) as GoalView).name);
  await savePreference(
    userId,
    {
      kind: "fact",
      key: GOAL_ORDER_FACT,
      value: { order: full.join(",") },
      label: `Goals in this order: ${names.join(", then ")}`,
    },
    { client },
  );
  await logAudit(
    { type: "user", id: userId },
    "goal_order_chosen",
    { type: "savings_goal", id: full[0] },
    { goals: full.length },
  );
  await track(userId, "goal_order_chosen", { goals: full.length });
  // The year plan is re-planned now, with the goals in their new order.
  await loadYearPlan(userId, { client, now, keep: true });
  return { order: full, names };
}
