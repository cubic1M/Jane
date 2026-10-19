import { MIN_MOVE_CENTS, TAX_GOAL_PATTERN } from "@/config/money-movement";
import type { Sector } from "@/config/autopilot-sectors";

// A paycheck's plan (spec step 144). Pure: after a paycheck, each goal's share of its
// monthly amount goes to its account (the emergency fund and the tax set-aside are goals
// too), and the payoff plan's extra to the first debt in its order. Bills stay in checking.
// Never moves money safe to spend needs: goals only from what bills and budgets leave, the
// debt extra only from safe to spend itself, both above the cushion, and never more than
// the paycheck.

export type PlanGoal = {
  id: string;
  name: string;
  monthlyCents: number;
  // The savings account its progress is, or null when tracked by hand.
  accountId: string | null;
  onTheWay: boolean;
};

export type PaycheckPlanInput = {
  paycheckCents: number;
  paychecksPerMonth: number;
  checkingAccountId: string;
  // Where money for a goal tracked by hand goes.
  savingsAccount: { id: string; name: string } | null;
  accountNames: Readonly<Record<string, string>>;
  // Safe to spend's parts, right after the paycheck.
  balanceCents: number;
  billsCents: number;
  budgetsLeftCents: number;
  safeCents: number;
  cushionCents: number;
  goals: PlanGoal[];
  debt: { accountId: string; name: string; extraCents: number } | null;
};

export type PlannedMove = {
  purpose: "goal" | "debt";
  sector: Sector;
  // What the sector's autopilot needs to do it by itself: a move to the person's own
  // savings is the safe stuff; a payment to a lender leaves their hands.
  needs: "safe" | "all";
  label: string;
  goalId: string | null;
  fromAccountId: string;
  toAccountId: string;
  toName: string;
  cents: number;
};

export type PaycheckPlanResult = {
  moves: PlannedMove[];
  // What stays in checking for bills before the next paycheck.
  billsCents: number;
  movedCents: number;
  // Why less moved than the plan wanted, if it did.
  heldBack: "cushion" | "paycheck" | null;
};

export function paycheckPlan(input: PaycheckPlanInput): PaycheckPlanResult {
  const per = Math.max(1, input.paychecksPerMonth);
  let left = input.paycheckCents;
  let goalRoom = Math.max(
    0,
    input.balanceCents - input.billsCents - input.budgetsLeftCents - input.cushionCents,
  );
  let extraRoom = Math.max(0, input.safeCents - input.cushionCents);
  let heldBack: PaycheckPlanResult["heldBack"] = null;
  const moves: PlannedMove[] = [];

  const take = (want: number, room: number) => {
    const cents = Math.min(want, room, left);
    if (cents < want) heldBack = cents < Math.min(want, room) ? "paycheck" : "cushion";
    return cents;
  };

  for (const goal of input.goals) {
    if (!goal.onTheWay || goal.monthlyCents <= 0) continue;
    const to = goal.accountId
      ? { id: goal.accountId, name: input.accountNames[goal.accountId] ?? goal.name }
      : input.savingsAccount;
    if (!to || to.id === input.checkingAccountId) continue;
    const cents = take(Math.ceil(goal.monthlyCents / per), goalRoom);
    if (cents < MIN_MOVE_CENTS) continue;
    goalRoom -= cents;
    left -= cents;
    moves.push({
      purpose: "goal",
      sector: TAX_GOAL_PATTERN.test(goal.name) ? "taxes" : "goals",
      needs: "safe",
      label: `"${goal.name}"`,
      goalId: goal.id,
      fromAccountId: input.checkingAccountId,
      toAccountId: to.id,
      toName: to.name,
      cents,
    });
  }

  if (input.debt && input.debt.extraCents > 0) {
    const cents = take(Math.ceil(input.debt.extraCents / per), extraRoom);
    if (cents >= MIN_MOVE_CENTS) {
      extraRoom -= cents;
      left -= cents;
      moves.push({
        purpose: "debt",
        sector: "debt",
        needs: "all",
        label: `extra toward ${input.debt.name}`,
        goalId: null,
        fromAccountId: input.checkingAccountId,
        toAccountId: input.debt.accountId,
        toName: input.debt.name,
        cents,
      });
    }
  }

  return {
    moves,
    billsCents: input.billsCents,
    movedCents: moves.reduce((sum, m) => sum + m.cents, 0),
    heldBack,
  };
}
