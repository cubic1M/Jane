// People with a shaped net worth history for the chart's specs (founder: a big change in net
// worth made every smaller move a flat line): one balance a day, small day-to-day moves around a
// base and, optionally, ONE big step. Deterministic (a seeded sequence), so a spec and a
// screenshot show the same line each time. Pure, so a script can read it too.
export type HistoryShape = {
  baseCents: number;
  days: number;
  moveMinCents: number;
  moveMaxCents: number;
  // The step's day, as days ago, and its size.
  stepDaysAgo?: number;
  stepCents?: number;
};

// The balances, oldest first, ending today.
export function historyBalances(shape: HistoryShape): number[] {
  let seed = 7;
  const next = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
  const out: number[] = [];
  let balance = shape.baseCents;
  let stepped = false;
  for (let ago = shape.days; ago >= 0; ago--) {
    const size = shape.moveMinCents + next() * (shape.moveMaxCents - shape.moveMinCents);
    const sign = next() < 0.5 ? -1 : 1;
    // A pull back toward the base keeps the walk around it (the base moves up with the step: a
    // big deposit stays).
    const base = shape.baseCents + (stepped ? (shape.stepCents ?? 0) : 0);
    const pull = (base - balance) * 0.05;
    balance += Math.round(sign * size + pull);
    if (ago === shape.stepDaysAgo) {
      balance += shape.stepCents ?? 0;
      stepped = true;
    }
    out.push(balance);
  }
  return out;
}

// The two people the founder described: several thousand dollars with a +$5,120 step two months
// ago; and about $160,000 with moves of $50 to $300 and no step.
export const STEP_PERSON: HistoryShape = {
  baseCents: 600_000,
  days: 150,
  moveMinCents: 2_000,
  moveMaxCents: 30_000,
  stepDaysAgo: 60,
  stepCents: 512_000,
};
export const BIG_BALANCE_PERSON: HistoryShape = {
  baseCents: 16_000_000,
  days: 150,
  moveMinCents: 5_000,
  moveMaxCents: 30_000,
};
