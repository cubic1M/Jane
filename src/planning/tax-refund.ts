import { REFUND } from "@/config/tax";

// Tax refunds (spec step 125). Pure: spotting a refund in the deposits, matching it to the
// estimate for its year, and a plan for where it could go (demo advice): the emergency fund
// first, then debt at a high rate, then goals that are behind. The plan is only a plan:
// setting it up adds goals and reminders, and nothing moves without the person.

export type RefundDeposit = {
  id: string;
  date: string;
  // Plaid's sign: money in is negative.
  amountCents: number;
  description: string;
  merchantName: string | null;
  pfcDetailed: string | null;
};

export type Refund = {
  transactionId: string;
  date: string;
  cents: number;
  to: "federal" | "state";
  // Refunds land the year after the tax year they're for.
  taxYear: number;
};

export function findRefunds(deposits: RefundDeposit[]): Refund[] {
  return deposits
    .filter((t) => {
      if (t.amountCents >= 0) return false;
      const text = `${t.description} ${t.merchantName ?? ""}`;
      return t.pfcDetailed === "INCOME_TAX_REFUND" || REFUND.payee.test(text);
    })
    .map((t): Refund => ({
      transactionId: t.id,
      date: t.date,
      cents: -t.amountCents,
      to: REFUND.federalPayee.test(`${t.description} ${t.merchantName ?? ""}`)
        ? "federal"
        : "state",
      taxYear: Number(t.date.slice(0, 4)) - 1,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export type RefundMatch = { estimatedCents: number; diffCents: number; matches: boolean };

// Against the estimated refund for the year (null when there was no refund estimated).
export function matchRefund(
  receivedCents: number,
  estimatedCents: number | null,
): RefundMatch | null {
  if (estimatedCents === null) return null;
  const diff = receivedCents - estimatedCents;
  const near = Math.max(REFUND.matchCents, Math.abs(estimatedCents) * REFUND.matchShare);
  return { estimatedCents, diffCents: diff, matches: Math.abs(diff) <= near };
}

export type RefundPlanItem =
  | { kind: "emergency"; cents: number; label: string }
  | { kind: "debt"; cents: number; label: string; accountName: string; aprBps: number }
  | { kind: "goal"; cents: number; label: string; goalId: string; goalName: string };

export function refundPlan(input: {
  cents: number;
  emergency: { targetCents: number; haveCents: number };
  debts: { accountName: string; balanceCents: number; aprBps: number }[];
  goals: { id: string; name: string; leftCents: number; behind: boolean }[];
}): { items: RefundPlanItem[]; leftCents: number } {
  let left = input.cents;
  const items: RefundPlanItem[] = [];
  const gap = Math.max(0, input.emergency.targetCents - input.emergency.haveCents);
  if (gap > 0 && left > 0) {
    const cents = Math.min(gap, left);
    items.push({ kind: "emergency", cents, label: "your emergency fund" });
    left -= cents;
  }
  for (const debt of [...input.debts]
    .filter((d) => d.aprBps >= REFUND.debtAprBps && d.balanceCents > 0)
    .sort((a, b) => b.aprBps - a.aprBps)) {
    if (left <= 0) break;
    const cents = Math.min(debt.balanceCents, left);
    items.push({
      kind: "debt",
      cents,
      label: `the ${debt.accountName} (${(debt.aprBps / 100).toFixed(2)}%)`,
      accountName: debt.accountName,
      aprBps: debt.aprBps,
    });
    left -= cents;
  }
  for (const goal of input.goals.filter((g) => g.behind && g.leftCents > 0)) {
    if (left <= 0) break;
    const cents = Math.min(goal.leftCents, left);
    items.push({
      kind: "goal",
      cents,
      label: `your "${goal.name}" goal`,
      goalId: goal.id,
      goalName: goal.name,
    });
    left -= cents;
  }
  return { items, leftCents: left };
}
