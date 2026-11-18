import { HOME_STATE_MIN_MATCHES, HOME_STATE_MIN_SHARE } from "@/config/profile";
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
