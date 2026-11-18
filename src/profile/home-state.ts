import {
  HOME_STATE_MIN_MATCHES,
  HOME_STATE_MIN_SHARE,
  STATE_MOVE_MIN_PER_MONTH,
} from "@/config/profile";
import { isStateCode } from "@/config/referrals";

// The state a person lives in, read from where they pay (suggest-taxes, 11-18): a card purchase's
// line ends in its city and state ("SAFEWAY #1234 MOUNTAIN VIEW CA", "NETFLIX.COM CA 10/14"). The
// state most of their located purchases are in, when there are enough of them and one state clearly
// leads; a trip doesn't move anyone. Pure.

// The two letters before the end of the line, or before a trailing "MM/DD" date.
const LOCATED = /\s([A-Z]{2})(?:\s+\d{2}\/\d{2})?\s*$/;

export function stateOfPayments(
  txs: readonly { amountCents: number; description: string }[],
): { code: string; matches: number } | null {
  const counts = new Map<string, number>();
  let located = 0;
  for (const t of txs) {
    if (t.amountCents <= 0) continue;
    const code = LOCATED.exec(t.description.toUpperCase())?.[1];
    if (!code || !isStateCode(code)) continue;
    located += 1;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!best || best[1] < HOME_STATE_MIN_MATCHES || best[1] / located < HOME_STATE_MIN_SHARE)
    return null;
  return { code: best[0], matches: best[1] };
}

// A move between states inside the data: the months before are mostly in one state and the months
// after mostly in another, each month with enough located purchases, and no month after going back.
export function stateMove(
  txs: readonly { date: string; amountCents: number; description: string }[],
): { from: string; to: string; month: string } | null {
  const byMonth = new Map<string, { amountCents: number; description: string }[]>();
  for (const t of txs)
    byMonth.set(t.date.slice(0, 7), [...(byMonth.get(t.date.slice(0, 7)) ?? []), t]);
  const months = [...byMonth.keys()]
    .sort()
    .map((month) => {
      const counts = new Map<string, number>();
      for (const t of byMonth.get(month)!) {
        if (t.amountCents <= 0) continue;
        const code = LOCATED.exec(t.description.toUpperCase())?.[1];
        if (code && isStateCode(code)) counts.set(code, (counts.get(code) ?? 0) + 1);
      }
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      return best && best[1] >= STATE_MOVE_MIN_PER_MONTH && best[1] / total >= HOME_STATE_MIN_SHARE
        ? { month, state: best[0] }
        : null;
    })
    .filter((m): m is { month: string; state: string } => m !== null);
  if (months.length < 2) return null;
  const first = months[0].state;
  const switched = months.findIndex((m) => m.state !== first);
  if (switched < 0) return null;
  const to = months[switched].state;
  // Every month after the switch is in the new state: a trip home isn't a move.
  if (months.slice(switched).some((m) => m.state !== to)) return null;
  return { from: first, to, month: months[switched].month };
}
