// Savings goal math: how far along a goal is, and what it would take each month to reach
// it by the date. Math only, never a recommendation (see goals-copy.ts). Pure; dates are
// YYYY-MM-DD.

export type GoalInput = { targetCents: number; savedCents: number; targetDate: string };

export type GoalProgress =
  | { status: "reached"; savedCents: number; percent: number }
  | { status: "date_passed"; savedCents: number; leftCents: number; percent: number }
  | {
      status: "on_the_way";
      savedCents: number;
      leftCents: number;
      percent: number;
      monthsLeft: number;
      monthlyCents: number;
    };

// Whole months from asOf to the target date: a month counts once its day-of-month comes
// round again, so Oct 20 to Apr 20 is 6 and Oct 20 to Jan 15 is 2. At least 1 while the
// date is still ahead.
export function monthsUntil(asOf: string, targetDate: string): number {
  const [y, m, d] = asOf.split("-").map(Number);
  const [ty, tm, td] = targetDate.split("-").map(Number);
  const months = (ty - y) * 12 + (tm - m) - (td < d ? 1 : 0);
  return Math.max(1, months);
}

export function goalProgress(goal: GoalInput, asOf: string): GoalProgress {
  const saved = Math.max(0, goal.savedCents);
  const percent = Math.min(100, Math.floor((saved / goal.targetCents) * 100));
  if (saved >= goal.targetCents) return { status: "reached", savedCents: saved, percent: 100 };
  const left = goal.targetCents - saved;
  if (goal.targetDate <= asOf) {
    return { status: "date_passed", savedCents: saved, leftCents: left, percent };
  }
  const monthsLeft = monthsUntil(asOf, goal.targetDate);
  return {
    status: "on_the_way",
    savedCents: saved,
    leftCents: left,
    percent,
    monthsLeft,
    // Rounded up to the cent, so the monthly amounts add up to at least the target.
    monthlyCents: Math.ceil(left / monthsLeft),
  };
}

// Whether a goal is on track, the one rule for Home's Plans tile, the Money page, the money hub and
// the Plans tree (gate B: the first three counted any goal whose date hadn't passed, late or not,
// and a reached one too, where the tree counted only goals on the way and in time): on the way, and
// not running late once the person's other goals are counted (goal trade-offs' late months).
export const goalOnTrack = (g: { status: GoalProgress["status"]; lateMonths?: number | null }) =>
  g.status === "on_the_way" && !((g.lateMonths ?? 0) > 0);

// "N of M goals on track": of the goals not reached yet.
export function goalsOnTrack(
  goals: readonly { status: GoalProgress["status"]; lateMonths?: number | null }[],
): { onTrack: number; total: number; reached: number } {
  const open = goals.filter((g) => g.status !== "reached");
  return {
    onTrack: open.filter(goalOnTrack).length,
    total: open.length,
    reached: goals.length - open.length,
  };
}
