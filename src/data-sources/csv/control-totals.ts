import {
  CONTROL_BALANCE_BROKEN_SHARE,
  CONTROL_MIN_SIGN_VOTES,
  CONTROL_MIN_STEPS,
  CONTROL_SIGN_REVERSED_SHARE,
  CONTROL_TOLERANCE_CENTS,
} from "@/config/import";
import type { AccountKind } from "@/data-sources/types";
import { directionOf } from "@/data-sources/csv/column-mapping";
import { dayLabel } from "@/lib/day-label";
import { formatCents, parseMoneyToCents } from "@/lib/money";
import type { CsvRecord } from "./parse-csv";
import type { ParsedRow } from "./formats";

// Whether a statement adds up, before anything is worked out from it: the rows against its running
// balance, against the totals it states, and which way its signs run. What doesn't add up becomes
// a warning the person reads, and a balance column that doesn't follow from the rows is left out
// rather than shown as the account's balance. Pure, and says only numbers and dates: warnings are
// kept with the upload's record, and nothing from a row's description goes in them.

export type ControlWarning = {
  code:
    | "balance_gap"
    | "not_a_balance"
    | "statement_total"
    | "signs_reversed"
    | "rows_unread"
    | "row_count"
    | "repeated_header"
    | "cut_off"
    | "same_id";
  message: string;
};

// Which way a running balance moves as money goes out: down for a bank account, up for a card's
// balance written as what's owed.
export type BalanceWay = "down" | "up";

export type ControlReport = {
  // inFile = read + skipped + leftOut, always (control-totals.property.test.ts).
  rows: { inFile: number; read: number; skipped: number; leftOut: number };
  warnings: ControlWarning[];
  // False when the balance column doesn't follow from the rows at all: not used as a balance.
  balancesTrusted: boolean;
  // The way the file's balance moves, when its rows settle it.
  balanceWay: BalanceWay | null;
  // The file's signs run against its own balance, read as this kind of account.
  signsReversed: boolean;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const near = (a: number, b: number) => Math.abs(a - b) <= CONTROL_TOLERANCE_CENTS;
const sumOf = (rows: readonly { amountCents: number }[]) =>
  rows.reduce((sum, r) => sum + r.amountCents, 0);
// What a running balance does for rows that moved `cents`, written Plaid's way.
const moved = (cents: number, way: BalanceWay) => (way === "down" ? -cents : cents);

export type DayBalance = { date: string; balanceCents: number };
type Row = Pick<ParsedRow, "date" | "amountCents" | "balanceCents">;

// Each day's closing balance from a running-balance column. A running balance is the balance
// after its row, so the day's closing row is the one no other row of that day leads to: each
// row's balance before it (its balance plus what went out) is another row's balance after, all
// but the first's. That holds whatever order the rows of a day are listed in (import QA: a file
// newest-first by day but oldest-first within one). When it can't single one out (two rows that
// cancel out), the file's order decides: the first row seen when the file is newest first
// (Chase), the last when it's oldest first (Bank of America).
export function closingBalances(rows: readonly Row[], way: BalanceWay = "down"): DayBalance[] {
  const withBalance = rows.filter((r) => r.balanceCents !== undefined);
  const [first, last] = [withBalance[0], withBalance[withBalance.length - 1]];
  if (!first || !last) return [];
  const newestFirst = first.date > last.date;
  const byDay = new Map<string, Row[]>();
  for (const row of withBalance) byDay.set(row.date, [...(byDay.get(row.date) ?? []), row]);
  return [...byDay]
    .map(([date, day]) => {
      const closing = closingRows(day, way);
      const row = closing.length === 1 ? closing[0]! : newestFirst ? day[0]! : day[day.length - 1]!;
      return { date, balanceCents: row.balanceCents! };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function closingRows(day: readonly Row[], way: BalanceWay): readonly Row[] {
  const before = new Set(day.map((r) => r.balanceCents! - moved(r.amountCents, way)));
  return day.filter((r) => !before.has(r.balanceCents!));
}

type Walk = { steps: number; breaks: { date: string; gapCents: number }[] };

// Walks the balance column a day at a time: each day's closing balance has to be the last one less
// what moved since. Some exports leave a pending row's balance empty, others print one only at the
// day's end, so a row with none may or may not have moved it; either reading passes.
function walkBalances(rows: readonly Row[], way: BalanceWay): Walk {
  const closes = closingBalances(rows, way);
  const walk: Walk = { steps: 0, breaks: [] };
  const firstDay = closes[0]?.date;
  const opening = rows.filter((r) => r.date === firstDay && r.balanceCents !== undefined);
  // The first day has no day before it: its rows have to lead to one another.
  if (
    opening.length > 1 &&
    rows.every((r) => r.date !== firstDay || r.balanceCents !== undefined)
  ) {
    walk.steps += opening.length - 1;
    const loose = closingRows(opening, way).length - 1;
    for (let i = 0; i < loose; i += 1) walk.breaks.push({ date: firstDay!, gapCents: 0 });
  }
  closes.forEach((close, i) => {
    const prior = closes[i - 1];
    if (!prior) return;
    const since = rows.filter((r) => r.date > prior.date && r.date <= close.date);
    const change = close.balanceCents - prior.balanceCents;
    const all = moved(sumOf(since), way);
    const booked = moved(sumOf(since.filter((r) => r.balanceCents !== undefined)), way);
    walk.steps += 1;
    if (!near(change, all) && !near(change, booked)) {
      walk.breaks.push({ date: close.date, gapCents: change - all });
    }
  });
  return walk;
}

export type StatedTotals = {
  openingCents?: number;
  closingCents?: number;
  creditsCents?: number;
  debitsCents?: number;
  // A plain "Total": some net, some money out only, so any of those passes.
  totalCents?: number;
  rowCount?: number;
};

const STATED: [keyof StatedTotals, RegExp][] = [
  ["openingCents", /^(?:beginning|opening|starting|previous) balance\b/i],
  // Not "new balance": that's a shoe shop on a statement as often as a total.
  ["closingCents", /^(?:ending|closing) balance\b/i],
  ["creditsCents", /^total (?:credits?|deposits?(?: and (?:other )?(?:credits|additions))?)\b/i],
  ["debitsCents", /^total (?:debits?|withdrawals?(?: and (?:other )?debits)?)\b/i],
  ["totalCents", /^totals?\s*:?\s*$/i],
];
const ROW_COUNT = /^(?:total transactions|number of transactions|transaction count)\b/i;

// The totals a statement states about itself, above or below its rows: Bank of America's block
// ("Beginning balance as of …", "Total credits") and footers like "Total" or "Ending balance".
export function statedTotals(records: readonly CsvRecord[]): StatedTotals {
  const stated: StatedTotals = {};
  for (const { fields } of records) {
    // In the first two columns: "Date,Beginning balance as of …,,1,234.56" has it in the second.
    const label = fields
      .slice(0, 2)
      .map((f) => f.trim())
      .find((f) => STATED.some(([, pattern]) => pattern.test(f)) || ROW_COUNT.test(f));
    if (!label) continue;
    const numbers = fields
      .slice(fields.indexOf(fields.find((f) => f.trim() === label) ?? "") + 1)
      .map((f) => parseMoneyToCents(f))
      .filter((n): n is number => n !== null);
    const value = numbers[numbers.length - 1];
    if (value === undefined) continue;
    if (ROW_COUNT.test(label)) {
      stated.rowCount = value / 100;
      continue;
    }
    const key = STATED.find(([, pattern]) => pattern.test(label))?.[0];
    // The first opening balance said, the last closing one.
    if (key && (key === "closingCents" || stated[key] === undefined)) stated[key] = value;
  }
  return stated;
}

function statedWarnings(
  rows: readonly Row[],
  stated: StatedTotals,
  way: BalanceWay | null,
): ControlWarning[] {
  const warnings: ControlWarning[] = [];
  const net = sumOf(rows);
  const out = sumOf(rows.filter((r) => r.amountCents > 0));
  const into = -sumOf(rows.filter((r) => r.amountCents < 0));
  const { openingCents: opening, closingCents: closing } = stated;
  if (opening !== undefined && closing !== undefined) {
    const ways: BalanceWay[] = way ? [way] : ["down", "up"];
    if (!ways.some((w) => near(opening + moved(net, w), closing))) {
      const expected = opening + moved(net, ways[0]!);
      warnings.push({
        code: "statement_total",
        message: `This statement opens at ${formatCents(opening)} and closes at ${formatCents(closing)}, but its rows would close it at ${formatCents(expected)}. ${formatCents(Math.abs(closing - expected))} isn't explained, so some rows may be missing and totals from this file can be off.`,
      });
    }
  }
  const mismatch = (word: string, said: number, found: number) => ({
    code: "statement_total" as const,
    message: `This statement says ${formatCents(said)} of ${word}, and its rows come to ${formatCents(found)}, so totals from this file can be off.`,
  });
  const { creditsCents: credits, debitsCents: debits, totalCents: total } = stated;
  if (credits !== undefined && !near(Math.abs(credits), into)) {
    warnings.push(mismatch("money in", Math.abs(credits), into));
  }
  if (debits !== undefined && !near(Math.abs(debits), out)) {
    warnings.push(mismatch("money out", Math.abs(debits), out));
  }
  if (total !== undefined && ![Math.abs(net), out, into].some((n) => near(Math.abs(total), n))) {
    warnings.push(mismatch("in total", Math.abs(total), Math.abs(net)));
  }
  return warnings;
}

// Which way the file's signs run where there's no balance to check them by: what the rules know
// about each row, and on a card, that most rows are purchases.
export function signsLookReversed(
  rows: readonly { amountCents: number; description: string }[],
  kind: AccountKind | null,
): boolean {
  let against = 0;
  let votes = 0;
  for (const row of rows) {
    if (row.amountCents === 0) continue;
    const direction = directionOf(row.description);
    if (!direction) continue;
    votes += 1;
    if (row.amountCents > 0 !== (direction === "out")) against += 1;
  }
  if (votes >= CONTROL_MIN_SIGN_VOTES && against / votes >= CONTROL_SIGN_REVERSED_SHARE)
    return true;
  if (kind !== "credit_card") return false;
  const moving = rows.filter((r) => r.amountCents !== 0);
  const paidIn = moving.filter((r) => r.amountCents < 0).length;
  return (
    moving.length >= CONTROL_MIN_SIGN_VOTES && paidIn / moving.length >= CONTROL_SIGN_REVERSED_SHARE
  );
}

const REVERSED_NO_BALANCE =
  "The amounts look backwards: spending here reads as money coming in. Check them before relying on totals from this file.";

export function controlTotals({
  rows,
  described,
  stated,
  counts,
  unread,
  repeatedHeaders,
  kind,
}: {
  // Every row read, before a format's last word, in file order.
  rows: readonly Row[];
  // The rows kept, for reading their signs.
  described: readonly { amountCents: number; description: string }[];
  stated: StatedTotals;
  counts: ControlReport["rows"];
  // Rows that couldn't be read, not those a format leaves out on purpose.
  unread: number;
  repeatedHeaders: number;
  // What kind of account it is, when that's known yet.
  kind: AccountKind | null;
}): ControlReport {
  const warnings: ControlWarning[] = [];
  const hasBalances = rows.some((r) => r.balanceCents !== undefined);
  const down = walkBalances(rows, "down");
  const up = walkBalances(rows, "up");
  const settled = down.steps > 0 && down.breaks.length !== up.breaks.length;
  const balanceWay: BalanceWay | null = !hasBalances
    ? null
    : settled
      ? down.breaks.length < up.breaks.length
        ? "down"
        : "up"
      : null;
  const walk = balanceWay === "up" ? up : down;
  const broken = walk.steps > 0 && walk.breaks.length / walk.steps > CONTROL_BALANCE_BROKEN_SHARE;

  if (broken) {
    warnings.push({
      code: "not_a_balance",
      message:
        "The balance column doesn't follow from the rows, so Jane isn't using it as the account's balance. Check that it's the running balance and that no rows are missing.",
    });
  } else if (walk.breaks.length > 0) {
    const [first] = walk.breaks;
    const gap = walk.breaks.reduce((sum, b) => sum + Math.abs(b.gapCents), 0);
    warnings.push({
      code: "balance_gap",
      message: `The balance doesn't follow from the rows on ${plural(walk.breaks.length, "day")}, first on ${dayLabel(first!.date, { year: true })}${gap > 0 ? `: ${formatCents(gap)} isn't explained` : ""}. Some rows may be missing, so totals from this file can be off.`,
    });
  }

  const reversedByBalance =
    balanceWay === "up" && up.steps >= CONTROL_MIN_STEPS && kind !== "credit_card";
  if (reversedByBalance) {
    warnings.push({
      code: "signs_reversed",
      message:
        kind === null
          ? "The amounts run against the balance: money going out raises it. Unless this is a credit card, spending would read as money coming in, so change which sign is spending."
          : "The amounts run against the balance: money going out raises it, so spending reads as money coming in. Check them before relying on totals from this file.",
    });
  } else if (!hasBalances && signsLookReversed(described, kind)) {
    warnings.push({ code: "signs_reversed", message: REVERSED_NO_BALANCE });
  }

  warnings.push(...statedWarnings(rows, stated, balanceWay));

  if (unread > 0) {
    warnings.push({
      code: "rows_unread",
      message: `${unread} of ${plural(counts.inFile, "row")} couldn't be read, so totals from this file are short by ${unread === 1 ? "it" : "them"}.`,
    });
  }
  if (stated.rowCount !== undefined && stated.rowCount !== counts.read + unread) {
    warnings.push({
      code: "row_count",
      message: `This statement says it has ${plural(stated.rowCount, "transaction")}, and Jane found ${counts.read + unread}. Some rows may be missing.`,
    });
  }
  if (repeatedHeaders > 0) {
    warnings.push({
      code: "repeated_header",
      message:
        "This file has its column names more than once, as if downloads were pasted together, so some rows may count twice.",
    });
  }
  return {
    rows: counts,
    warnings,
    balancesTrusted: !broken,
    balanceWay,
    signsReversed: reversedByBalance,
  };
}
