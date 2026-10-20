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
  // Spec step 206: the most that can leave checking so its forecast low stays above the
  // buffer margin (the forecast's lowest balance less the margin). Null when unknown.
  forecastRoomCents?: number | null;
  // Invested for this payday by auto-invest (step 134), for the account of where it went.
  investedCents?: number;
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
  heldBack: "cushion" | "paycheck" | "buffer" | null;
  // Spec step 206: where every dollar of the paycheck went. The parts add up to it.
  wentTo: WentTo;
};

export type WentTo = {
  paycheckCents: number;
  billsCents: number;
  bufferCents: number;
  goalsCents: number;
  debtCents: number;
  investingCents: number;
  yoursCents: number;
};

// What actually moved (goals, debt, investing) is counted first, then what stays for bills
// and the buffer; what's left is theirs. The buffer and bills were protected when the moves
// were planned (the forecast room caps them), so this never takes a move back.
export function whereItWent(input: {
  paycheckCents: number;
  billsCents: number;
  bufferCents: number;
  goalsCents: number;
  debtCents: number;
  investingCents: number;
}): WentTo {
  let left = input.paycheckCents;
  const take = (cents: number) => {
    const t = Math.max(0, Math.min(cents, left));
    left -= t;
    return t;
  };
  const goals = take(input.goalsCents);
  const debt = take(input.debtCents);
  const investing = take(input.investingCents);
  const bills = take(input.billsCents);
  const buffer = take(input.bufferCents);
  return {
    paycheckCents: input.paycheckCents,
    bufferCents: buffer,
    billsCents: bills,
    goalsCents: goals,
    debtCents: debt,
    investingCents: investing,
    yoursCents: left,
  };
}

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
  // Spec step 206: the forecast's buffer caps everything that leaves checking together.
  let forecastLeft = input.forecastRoomCents ?? Number.POSITIVE_INFINITY;

  const take = (want: number, room: number) => {
    const cents = Math.max(0, Math.min(want, room, left, forecastLeft));
    if (cents < want) {
      heldBack =
        cents < Math.min(want, room, left) && forecastLeft <= Math.min(want, room, left)
          ? "buffer"
          : cents < Math.min(want, room)
            ? "paycheck"
            : "cushion";
    }
    forecastLeft -= cents;
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

  const movedCents = moves.reduce((sum, m) => sum + m.cents, 0);
  return {
    moves,
    billsCents: input.billsCents,
    movedCents,
    heldBack,
    wentTo: whereItWent({
      paycheckCents: input.paycheckCents,
      billsCents: input.billsCents,
      bufferCents: input.cushionCents,
      goalsCents: moves.filter((m) => m.purpose === "goal").reduce((s, m) => s + m.cents, 0),
      debtCents: moves.filter((m) => m.purpose === "debt").reduce((s, m) => s + m.cents, 0),
      investingCents: input.investedCents ?? 0,
    }),
  };
}
