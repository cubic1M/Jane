import {
  DIFFERENT_ACCOUNT_DAY_SLACK,
  DIFFERENT_ACCOUNT_MAX_RATIO,
  DIFFERENT_ACCOUNT_MIN_OVERLAP_DAYS,
  SAME_ACCOUNT_BALANCE_SLACK_CENTS,
  SAME_ACCOUNT_DAY_SLACK,
  SAME_ACCOUNT_EDGE_DAYS,
  SAME_ACCOUNT_MAX_LINES,
  SAME_ACCOUNT_MAX_STEPS,
  SAME_ACCOUNT_MATCH_RATIO,
  SAME_ACCOUNT_MIN_LINES,
} from "@/config/detection";
import { addDays } from "@/lib/dates";

// Whether an uploaded statement and a linked account of the same bank and kind are one account, by
// what each shows (the founder, 11-25: "double check the uploads and realize if it's wrong or right,
// and then just do it automatically"). Same: most of the lines they both cover are on both sides.
// Different: almost none are. Neither: too few lines, or no days in common, and then the closing
// balance may still say they are the same (it equals the link's on the statement's last day);
// otherwise Plaid wins and the upload is left out, said as not compared. Pure.

export type Line = { date: string; amountCents: number };
export type Verdict = "same" | "different" | "unknown";
export type Comparison = {
  verdict: Verdict;
  // How the verdict came: the lines, the balance, or nothing to go on.
  by: "lines" | "balance" | "none";
  matched: number;
  compared: number;
};

export type CompareInput = {
  upload: readonly Line[];
  link: readonly Line[];
  // The upload's closing balance and the day of it, and the link's balance on or just before a day
  // (null when its history doesn't reach that day).
  closing: { date: string; cents: number } | null;
  linkBalanceOn: (date: string) => number | null;
};

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

// Lines in the days both cover, matched one to one by amount and day (within the slack): the most
// that can be matched, not the first that are found (a nearest-day pick can take a line a later one
// needs). A line near the edge of those days is matched to its partner just outside them: the slack
// reaches past the edge on both sides. A line the bank reports as two legs (a transfer, a split)
// counts as matched when two of the other side's left-over lines within the slack add up to it; that
// is asked of each line on its own and uses none up, so no order of the lines decides it. Compared
// are the lines in the days both cover, less the first and last day (a history may start partway
// through its first day), on the side with fewer. At most SAME_ACCOUNT_MAX_LINES of each side, the
// newest, are looked at and at most SAME_ACCOUNT_MAX_STEPS steps taken: past that, `exhausted`.
export function matchLines(
  upload: readonly Line[],
  link: readonly Line[],
  slack: number = SAME_ACCOUNT_DAY_SLACK,
) {
  const none = { matched: 0, compared: 0, overlapDays: 0, exhausted: false };
  if (upload.length === 0 || link.length === 0) return none;
  const newest = (l: readonly Line[]) =>
    l.length <= SAME_ACCOUNT_MAX_LINES
      ? l
      : [...l].sort((a, b) => b.date.localeCompare(a.date)).slice(0, SAME_ACCOUNT_MAX_LINES);
  const [mine, theirs] = [newest(upload), newest(link)];
  const first = [mine, theirs].map((l) => l.reduce((m, x) => (x.date < m ? x.date : m), l[0].date));
  const last = [mine, theirs].map((l) => l.reduce((m, x) => (x.date > m ? x.date : m), l[0].date));
  const from = first[0] > first[1] ? first[0] : first[1];
  const to = last[0] < last[1] ? last[0] : last[1];
  if (from > to) return none;
  const coreFrom = addDays(from, SAME_ACCOUNT_EDGE_DAYS);
  const coreTo = addDays(to, -SAME_ACCOUNT_EDGE_DAYS);
  const within = (l: readonly Line[], a: string, b: string) =>
    l.filter((x) => x.date >= a && x.date <= b).sort((x, y) => x.date.localeCompare(y.date));
  const [u, k] = [
    within(mine, addDays(from, -slack), addDays(to, slack)),
    within(theirs, addDays(from, -slack), addDays(to, slack)),
  ];
  const inCore = (line: Line) => line.date >= coreFrom && line.date <= coreTo;
  const near = (a: Line, b: Line) => days(a.date, b.date) <= slack;
  let steps = 0;
  const spent = () => (steps += 1) > SAME_ACCOUNT_MAX_STEPS;
  // The most one-to-one pairs of equal amount within the slack (augmenting paths, per amount).
  const byAmount = new Map<number, number[]>();
  k.forEach((line, j) =>
    byAmount.set(line.amountCents, [...(byAmount.get(line.amountCents) ?? []), j]),
  );
  const takenBy = new Map<number, number>();
  const augment = (i: number, seen: Set<number>): boolean => {
    for (const j of byAmount.get(u[i].amountCents) ?? []) {
      if (spent()) return false;
      if (seen.has(j) || !near(u[i], k[j])) continue;
      seen.add(j);
      const holder = takenBy.get(j);
      if (holder === undefined || augment(holder, seen)) {
        takenBy.set(j, i);
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < u.length && steps <= SAME_ACCOUNT_MAX_STEPS; i += 1) augment(i, new Set());
  const usedU = new Set(takenBy.values());
  const usedK = new Set(takenBy.keys());
  let matched = [...usedU].filter((i) => inCore(u[i])).length;
  // A left-over line that two left-over lines on the other side, within the slack, add up to: only
  // the other side's lines in its day window are looked at (they are sorted by day).
  const split = (line: Line, others: readonly Line[], used: ReadonlySet<number>) => {
    let lo = 0;
    let hi = others.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (others[mid].date < addDays(line.date, -slack)) lo = mid + 1;
      else hi = mid;
    }
    const counts = new Map<number, number>();
    const window: number[] = [];
    for (
      let idx = lo;
      idx < others.length && others[idx].date <= addDays(line.date, slack);
      idx += 1
    ) {
      if (used.has(idx) || spent()) continue;
      window.push(others[idx].amountCents);
      counts.set(others[idx].amountCents, (counts.get(others[idx].amountCents) ?? 0) + 1);
    }
    return window.some((c) => {
      const need = line.amountCents - c;
      return (counts.get(need) ?? 0) > (need === c ? 1 : 0);
    });
  };
  u.forEach((line, i) => {
    if (!usedU.has(i) && inCore(line) && !spent() && split(line, k, usedK)) matched += 1;
  });
  k.forEach((line, j) => {
    if (!usedK.has(j) && inCore(line) && !spent() && split(line, u, usedU)) matched += 1;
  });
  return {
    matched,
    compared: Math.min(u.filter(inCore).length, k.filter(inCore).length),
    overlapDays: days(from, to) + 1,
    exhausted: steps > SAME_ACCOUNT_MAX_STEPS,
  };
}

// "Same" when most of what they both show is on both sides. "Different" only when it is clean: enough
// lines, enough days in common, almost none alike even with a wider day slack, and the work within
// its budget. Everything else the lines can't say is "unknown", which leaves the upload out.
export function compareAccounts({
  upload,
  link,
  closing,
  linkBalanceOn,
}: CompareInput): Comparison {
  const tight = matchLines(upload, link);
  const matched = Math.min(tight.matched, tight.compared);
  const { compared, overlapDays } = tight;
  if (!tight.exhausted && compared >= SAME_ACCOUNT_MIN_LINES) {
    const ratio = matched / compared;
    if (ratio >= SAME_ACCOUNT_MATCH_RATIO)
      return { verdict: "same", by: "lines", matched, compared };
    if (ratio <= DIFFERENT_ACCOUNT_MAX_RATIO && overlapDays >= DIFFERENT_ACCOUNT_MIN_OVERLAP_DAYS) {
      const loose = matchLines(upload, link, DIFFERENT_ACCOUNT_DAY_SLACK);
      // The same lines with their signs turned (money out on one side is money in on the other):
      // that is one account written two ways, never two.
      const flipped = matchLines(
        upload.map((l) => ({ ...l, amountCents: -l.amountCents })),
        link,
        DIFFERENT_ACCOUNT_DAY_SLACK,
      );
      if (
        flipped.exhausted ||
        flipped.matched / (flipped.compared || 1) > DIFFERENT_ACCOUNT_MAX_RATIO
      )
        return { verdict: "unknown", by: "none", matched, compared };
      const looseCompared = Math.min(loose.matched, loose.compared);
      if (
        !loose.exhausted &&
        loose.compared >= SAME_ACCOUNT_MIN_LINES &&
        looseCompared / loose.compared <= DIFFERENT_ACCOUNT_MAX_RATIO
      )
        return { verdict: "different", by: "lines", matched, compared };
    }
  }
  // The lines can't say. A closing balance equal to the link's on that day can.
  if (closing) {
    const theirsOn = linkBalanceOn(closing.date);
    if (theirsOn !== null && Math.abs(theirsOn - closing.cents) <= SAME_ACCOUNT_BALANCE_SLACK_CENTS)
      return { verdict: "same", by: "balance", matched, compared };
  }
  return { verdict: "unknown", by: "none", matched, compared };
}

// The link's balance on a day, from its readings: the last one on or before it, no more than `slack`
// days earlier, and only when its history reaches that far back.
export function balanceOnOrBefore(
  readings: readonly { date: string; balanceCents: number }[],
  date: string,
  slackDays: number,
): number | null {
  const before = readings
    .filter((r) => r.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date));
  const at = before[0];
  return at && at.date >= addDays(date, -slackDays) ? at.balanceCents : null;
}
