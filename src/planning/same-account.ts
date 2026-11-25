import {
  DIFFERENT_ACCOUNT_MAX_RATIO,
  SAME_ACCOUNT_BALANCE_SLACK_CENTS,
  SAME_ACCOUNT_DAY_SLACK,
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

// Lines in the days both cover, matched one to one by amount and day (within the slack).
export function matchLines(upload: readonly Line[], link: readonly Line[]) {
  if (upload.length === 0 || link.length === 0) return { matched: 0, compared: 0 };
  const first = [upload, link].map((l) => l.reduce((m, x) => (x.date < m ? x.date : m), l[0].date));
  const last = [upload, link].map((l) => l.reduce((m, x) => (x.date > m ? x.date : m), l[0].date));
  const from = first[0] > first[1] ? first[0] : first[1];
  const to = last[0] < last[1] ? last[0] : last[1];
  if (from > to) return { matched: 0, compared: 0 };
  const inside = (l: readonly Line[]) =>
    l.filter((x) => x.date >= from && x.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const [u, k] = [inside(upload), inside(link)];
  const used = new Set<number>();
  let matched = 0;
  for (const line of u) {
    let best = -1;
    let bestGap = Infinity;
    k.forEach((other, i) => {
      if (used.has(i) || other.amountCents !== line.amountCents) return;
      const gap = days(line.date, other.date);
      if (gap <= SAME_ACCOUNT_DAY_SLACK && gap < bestGap) [best, bestGap] = [i, gap];
    });
    if (best >= 0) {
      used.add(best);
      matched += 1;
    }
  }
  return { matched, compared: Math.min(u.length, k.length) };
}

export function compareAccounts({
  upload,
  link,
  closing,
  linkBalanceOn,
}: CompareInput): Comparison {
  const { matched, compared } = matchLines(upload, link);
  if (compared >= SAME_ACCOUNT_MIN_LINES) {
    const ratio = matched / compared;
    if (ratio >= SAME_ACCOUNT_MATCH_RATIO)
      return { verdict: "same", by: "lines", matched, compared };
    if (ratio <= DIFFERENT_ACCOUNT_MAX_RATIO)
      return { verdict: "different", by: "lines", matched, compared };
  }
  // The lines can't say. A closing balance equal to the link's on that day can.
  if (closing) {
    const theirs = linkBalanceOn(closing.date);
    if (theirs !== null && Math.abs(theirs - closing.cents) <= SAME_ACCOUNT_BALANCE_SLACK_CENTS)
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
