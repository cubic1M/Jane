// People with a shaped net worth history for the chart's specs (founder: a big change in net
// worth made every smaller move a flat line): one balance a day, small day-to-day moves around a
// base and, optionally, ONE big step. Deterministic (a seeded sequence), so a spec and a
// screenshot show the same line each time. Pure, so a script can read it too.
export type HistoryShape = {
  baseCents: number;
  days: number;
  moveMinCents: number;
  moveMaxCents: number;
  // The big steps: each one's day (days ago) and size.
  steps?: { daysAgo: number; cents: number }[];
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
  let stepped = 0;
  for (let ago = shape.days; ago >= 0; ago--) {
    const size = shape.moveMinCents + next() * (shape.moveMaxCents - shape.moveMinCents);
    const sign = next() < 0.5 ? -1 : 1;
    // A pull back toward the base keeps the walk around it (the base moves up with the step: a
    // big deposit stays).
    const base = shape.baseCents + stepped;
    const pull = (base - balance) * 0.05;
    balance += Math.round(sign * size + pull);
    for (const step of shape.steps ?? []) {
      if (ago !== step.daysAgo) continue;
      balance += step.cents;
      stepped += step.cents;
    }
    out.push(balance);
  }
  return out;
}

// Founder, Nov 28: a -$18,000 day and a +$9,000 day, with ordinary days of $12 to $128 around them.
// The last 45 days hold only the ordinary ones.
export const SMALL_MOVES_PERSON: HistoryShape = {
  baseCents: 3_000_000,
  days: 150,
  moveMinCents: 1_200,
  moveMaxCents: 12_800,
  steps: [
    { daysAgo: 100, cents: -1_800_000 },
    { daysAgo: 45, cents: 900_000 },
  ],
};
