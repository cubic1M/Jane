import {
  DIFFERENT_ACCOUNT_DAY_SLACK,
  DIFFERENT_ACCOUNT_MAX_RATIO,
  DIFFERENT_ACCOUNT_MIN_OVERLAP_DAYS,
  SAME_ACCOUNT_BALANCE_SLACK_CENTS,
  SAME_ACCOUNT_DAY_SLACK,
  SAME_ACCOUNT_EDGE_DAYS,
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
  // Either side had more lines than were read: what was read is not all there is.
  truncated?: boolean;
};

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

// Lines in the days both cover, matched exactly and one to one: the same amount (and sign), on days
// within the slack. A line near the edge of those days is matched to its partner just outside them.
// Per amount, both sides sorted by day, each line takes the earliest unused partner in its window:
// that is the most that can be matched, and the work is the sorting. Coverage is counted on each
// side's own lines in the days both cover, less the first and last day (a history may start partway
// through its first day): of the lines there, how many have a partner, and how many there are.
export function matchLines(
  upload: readonly Line[],
  link: readonly Line[],
  slack: number = SAME_ACCOUNT_DAY_SLACK,
) {
  const zero = { matched: 0, lines: 0 };
  const none = { upload: zero, link: zero, fullUpload: zero, fullLink: zero, overlapDays: 0 };
  if (upload.length === 0 || link.length === 0) return none;
  const first = [upload, link].map((l) => l.reduce((m, x) => (x.date < m ? x.date : m), l[0].date));
  const last = [upload, link].map((l) => l.reduce((m, x) => (x.date > m ? x.date : m), l[0].date));
  const from = first[0] > first[1] ? first[0] : first[1];
  const to = last[0] < last[1] ? last[0] : last[1];
  if (from > to) return none;
  const coreFrom = addDays(from, SAME_ACCOUNT_EDGE_DAYS);
  const coreTo = addDays(to, -SAME_ACCOUNT_EDGE_DAYS);
  const inCore = (line: Line) => line.date >= coreFrom && line.date <= coreTo;
  // Also counted whole, edge days and all: a match across the first or last shared day shows there.
  const inFull = (line: Line) => line.date >= from && line.date <= to;
  const byAmount = (lines: readonly Line[]) => {
    const out = new Map<number, Line[]>();
    for (const l of lines) out.set(l.amountCents, [...(out.get(l.amountCents) ?? []), l]);
    for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  };
  const [mine, theirs] = [byAmount(upload), byAmount(link)];
  let [matchedU, matchedK, fullU, fullK] = [0, 0, 0, 0];
  for (const [amount, ours] of mine) {
    const others = theirs.get(amount);
    if (!others) continue;
    let j = 0;
    for (const line of ours) {
      while (
        j < others.length &&
        days(others[j].date, line.date) > slack &&
        others[j].date < line.date
      )
        j += 1;
      if (j < others.length && days(others[j].date, line.date) <= slack) {
        if (inCore(line)) matchedU += 1;
        if (inCore(others[j])) matchedK += 1;
        if (inFull(line)) fullU += 1;
        if (inFull(others[j])) fullK += 1;
        j += 1;
      }
    }
  }
  return {
    upload: { matched: matchedU, lines: upload.filter(inCore).length },
    link: { matched: matchedK, lines: link.filter(inCore).length },
    fullUpload: { matched: fullU, lines: upload.filter(inFull).length },
    fullLink: { matched: fullK, lines: link.filter(inFull).length },
    overlapDays: days(from, to) + 1,
  };
}

// "Same": most of what one side shows in the days both cover is on the other (an upload that is
// only part of the account is still the same account), or the closing balance equals the link's.
// "Different": clean evidence only: enough shared days, enough lines on BOTH sides in them, almost
// none alike on either side, even with a wider day slack and with the signs turned, nothing cut
// short, and a closing balance that is not the link's when that is known. Everything else is
// "unknown", which leaves the upload out and says so.
export function compareAccounts({
  upload,
  link,
  closing,
  linkBalanceOn,
  truncated = false,
}: CompareInput): Comparison {
  const tight = matchLines(upload, link);
  const rate = (side: { matched: number; lines: number }) =>
    side.lines >= SAME_ACCOUNT_MIN_LINES ? side.matched / side.lines : 0;
  const best = Math.max(rate(tight.upload), rate(tight.link));
  const [matched, compared] =
    rate(tight.upload) >= rate(tight.link)
      ? [tight.upload.matched, tight.upload.lines]
      : [tight.link.matched, tight.link.lines];
  if (best >= SAME_ACCOUNT_MATCH_RATIO) return { verdict: "same", by: "lines", matched, compared };
  // A closing balance equal to the link's on that day says the same.
  const theirsOn = closing ? linkBalanceOn(closing.date) : null;
  if (
    closing &&
    theirsOn !== null &&
    Math.abs(theirsOn - closing.cents) <= SAME_ACCOUNT_BALANCE_SLACK_CENTS
  )
    return { verdict: "same", by: "balance", matched, compared };
  const low = (side: { matched: number; lines: number }) =>
    side.lines >= SAME_ACCOUNT_MIN_LINES &&
    side.matched / side.lines <= DIFFERENT_ACCOUNT_MAX_RATIO;
  if (
    !truncated &&
    tight.overlapDays >= DIFFERENT_ACCOUNT_MIN_OVERLAP_DAYS &&
    low(tight.upload) &&
    low(tight.link) &&
    low(tight.fullUpload) &&
    low(tight.fullLink)
  ) {
    const wide = matchLines(upload, link, DIFFERENT_ACCOUNT_DAY_SLACK);
    const flipped = matchLines(
      upload.map((l) => ({ ...l, amountCents: -l.amountCents })),
      link,
      DIFFERENT_ACCOUNT_DAY_SLACK,
    );
    if (
      low(wide.upload) &&
      low(wide.link) &&
      flipped.upload.matched === 0 &&
      flipped.link.matched === 0
    )
      return { verdict: "different", by: "lines", matched, compared };
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
