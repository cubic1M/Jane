import {
  TRADEOFF_HORIZON_MONTHS,
  TRADEOFF_MAX_PERMUTE,
  TRADEOFF_NOTICEABLE_MONTHS,
} from "@/config/tradeoffs";

// Goals that trade off openly (spec step 241). Pure: the goals, and the savings the year plan
// has room for each month, in; for each order the goals could be funded in, the month each
// reaches its target against the date the person wanted; a suggested order and why. Money
// goes to the first goal first, up to what it needs that month, then the next.

export type TradeGoal = {
  id: string;
  name: string;
  leftCents: number;
  // YYYY-MM the person wanted it by.
  wantedMonth: string;
  // What it needs each month to be on time.
  monthlyCents: number;
};

export type GoalDate = {
  id: string;
  name: string;
  // The month it's reached under this order, or null if beyond the horizon.
  month: string | null;
  wantedMonth: string;
  // Months later than wanted (0 on time, negative earlier).
  lateMonths: number | null;
};

export type TradeOrder = {
  order: string[];
  dates: GoalDate[];
  // Total months late across goals (a goal beyond the horizon counts as the horizon).
  totalLate: number;
};

export type Tradeoffs = {
  competing: boolean;
  options: TradeOrder[];
  suggested: TradeOrder | null;
  reason: string;
};

export const addMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthsBetween = (a: string, b: string) => {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

// Funds the goals in `order` month by month. capacity[i] is month i's room (Infinity when
// the plan wasn't tight); later months repeat the last.
export function fund(
  goals: TradeGoal[],
  order: string[],
  capacity: number[],
  startMonth: string,
): TradeOrder {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const left = new Map(goals.map((g) => [g.id, g.leftCents]));
  const reached = new Map<string, string>();
  for (let i = 0; i < TRADEOFF_HORIZON_MONTHS; i += 1) {
    let room = capacity[Math.min(i, capacity.length - 1)] ?? Number.POSITIVE_INFINITY;
    for (const id of order) {
      const g = byId.get(id)!;
      const need = Math.min(left.get(id)!, g.monthlyCents);
      const give = Math.min(need, room);
      left.set(id, left.get(id)! - give);
      room -= give;
      if (left.get(id)! <= 0 && !reached.has(id)) reached.set(id, addMonth(startMonth, i));
    }
    if (reached.size === goals.length) break;
  }
  const dates = order.map((id) => {
    const g = byId.get(id)!;
    const month = reached.get(id) ?? null;
    return {
      id,
      name: g.name,
      month,
      wantedMonth: g.wantedMonth,
      lateMonths: month === null ? null : monthsBetween(g.wantedMonth, month),
    };
  });
  const totalLate = dates.reduce(
    (s, d) => s + Math.max(0, d.lateMonths ?? TRADEOFF_HORIZON_MONTHS),
    0,
  );
  return { order, dates, totalLate };
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]),
  );
}

const lateWords = (d: GoalDate) =>
  d.lateMonths === null
    ? `${d.name} would not be reached in ten years`
    : d.lateMonths > TRADEOFF_NOTICEABLE_MONTHS
      ? `${d.name} slips ${d.lateMonths} months`
      : `${d.name} stays on time`;

export function tradeoffs(goals: TradeGoal[], capacity: number[], startMonth: string): Tradeoffs {
  if (goals.length < 2) return { competing: false, options: [], suggested: null, reason: "" };
  const wantedFirst = [...goals]
    .sort((a, b) => a.wantedMonth.localeCompare(b.wantedMonth) || a.id.localeCompare(b.id))
    .map((g) => g.id);
  const orders =
    goals.length <= TRADEOFF_MAX_PERMUTE
      ? permutations(wantedFirst)
      : [
          wantedFirst,
          [...goals]
            .sort((a, b) => a.leftCents - b.leftCents || a.id.localeCompare(b.id))
            .map((g) => g.id),
        ];
  const options = orders.map((o) => fund(goals, o, capacity, startMonth));
  // Competing when even the best order leaves a goal late.
  const best = [...options].sort(
    (a, b) =>
      a.totalLate - b.totalLate ||
      // Ties: the order that funds the earliest wanted dates first.
      wantedFirst.indexOf(a.order[0]) - wantedFirst.indexOf(b.order[0]) ||
      a.order.join().localeCompare(b.order.join()),
  )[0];
  const competing = options.some((o) =>
    o.dates.some((d) => d.lateMonths === null || d.lateMonths > TRADEOFF_NOTICEABLE_MONTHS),
  );
  if (!competing) return { competing: false, options, suggested: best, reason: "" };
  const first = best.dates[0];
  const others = best.dates.slice(1).map(lateWords).join(", ");
  return {
    competing,
    options: options.sort((a, b) => a.totalLate - b.totalLate),
    suggested: best,
    reason: `Putting ${first.name} first leaves the least delay overall: ${lateWords(first)}${others ? `; ${others}` : ""}.`,
  };
}
