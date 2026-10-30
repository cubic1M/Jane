import { CLOSE_CHIPS_MAX } from "@/config/close";
import type { CheckLine } from "@/detection/checkup";
import type { LedgerState } from "./ledger";

// The monthly close (/close/[month]): Jane closing a person's books for one month, like a
// controller. Five parts: what Jane found, what the person did, what was verified (with the
// lines), what changed (price rises, new fees, trials turning paid, renewals, bill jumps), and
// what's still open for next month. When nothing was wrong, the checkup says what Jane checked.
// At most CLOSE_CHIPS_MAX chips on top, the biggest dollars first. Pure.

// What the ledger (src/lib/ledger.ts) gives for each entry, as far as the close needs it.
export type CloseEntry = {
  key: string;
  title: string;
  state: LedgerState;
  cents: number;
  yearly: boolean;
  confidencePercent: number | null;
  foundOn: string | null;
  actedOn: string | null;
  verifiedOn: string | null;
  heldOn: string | null;
};

export type CloseChangeKind = "price_rise" | "bill_jump" | "new_fee" | "trial_paid" | "renewal";

// A change in the month, from src/insights/changes.ts (and trials that turned paid).
export type CloseChange = {
  key: string;
  kind: CloseChangeKind;
  date: string;
  title: string;
  // The new amount and, where there is one, what it usually was.
  amountCents: number;
  usualCents: number | null;
  // How sure Jane is: "84%", or a finding's band ("80%+").
  sure: string;
};

export type CloseChip = { label: string; figure: string; sure: string | null; href: string };

export type CloseInput<E extends CloseEntry = CloseEntry> = {
  month: string;
  today: string;
  entries: readonly E[];
  changes: readonly CloseChange[];
  checkup: readonly CheckLine[];
};

export type MonthClose<E extends CloseEntry = CloseEntry> = {
  month: string;
  // The month isn't over yet.
  soFar: boolean;
  found: E[];
  did: E[];
  verified: E[];
  changed: CloseChange[];
  open: E[];
  verifiedCents: number;
  foundCents: number;
  chips: CloseChip[];
  // Nothing found and nothing changed this month: the checkup leads.
  quiet: boolean;
  // Quiet, nothing open and no check found anything: nothing is wrong at all.
  allGood: boolean;
  checkup: { lines: CheckLine[]; found: number; passed: number; notEnoughData: number };
};

export const CHANGE_LABEL: Record<CloseChangeKind, string> = {
  price_rise: "Price went up",
  bill_jump: "Bill jumped",
  new_fee: "New fee",
  trial_paid: "Trial turned paid",
  renewal: "Insurance renewed",
};

const inMonth = (day: string | null, month: string) => day?.slice(0, 7) === month;
const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const OPEN_LABEL = {
  done: "Done, checking",
  said_yes: "You said yes",
  estimated: "Still to do",
} as const;

export function closeOf<E extends CloseEntry>(input: CloseInput<E>): MonthClose<E> {
  const { month, today, entries } = input;
  const byCents = (a: { cents: number }, b: { cents: number }) => b.cents - a.cents;
  const found = entries.filter((e) => inMonth(e.foundOn, month)).sort(byCents);
  // What the person did: a Yes alone isn't (manager decision 10-30, honest labels).
  const did = entries
    .filter((e) => e.state !== "said_yes" && inMonth(e.actedOn, month))
    .sort(byCents);
  const verified = entries
    .filter(
      (e) =>
        (e.state === "verified" || e.state === "held") &&
        (inMonth(e.verifiedOn, month) || inMonth(e.heldOn, month)),
    )
    .sort(byCents);
  const changed = input.changes
    .filter((c) => inMonth(c.date, month))
    .sort((a, b) => b.amountCents - a.amountCents || a.key.localeCompare(b.key));
  const open = entries
    .filter((e) => e.state === "estimated" || e.state === "said_yes" || e.state === "done")
    .sort(byCents);

  // The chips: what's open (biggest first) and what went up, at most CLOSE_CHIPS_MAX.
  const candidates: (CloseChip & { cents: number })[] = [
    ...open.map((e) => ({
      label: OPEN_LABEL[e.state as keyof typeof OPEN_LABEL] ?? "Still to do",
      figure: `${money(e.cents)}${e.yearly ? "/yr" : ""}`,
      sure: e.confidencePercent !== null ? `${e.confidencePercent}%` : null,
      href: "#open",
      cents: e.cents,
    })),
    ...changed.map((c) => ({
      label: CHANGE_LABEL[c.kind],
      figure:
        c.usualCents !== null ? `+${money(c.amountCents - c.usualCents)}` : money(c.amountCents),
      sure: c.sure,
      href: "#changed",
      // A rise counts by a year of it, so it sorts with the yearly savings.
      cents: (c.usualCents !== null ? c.amountCents - c.usualCents : c.amountCents) * 12,
    })),
  ];
  const chips = candidates
    .sort((a, b) => b.cents - a.cents)
    .slice(0, CLOSE_CHIPS_MAX)
    .map(({ cents: _cents, ...chip }) => chip);

  const lines = [...input.checkup];
  const count = (status: CheckLine["status"]) => lines.filter((l) => l.status === status).length;
  return {
    month,
    soFar: today.slice(0, 7) <= month,
    found,
    did,
    verified,
    changed,
    open,
    verifiedCents: verified.reduce((s, e) => s + e.cents, 0),
    foundCents: found.reduce((s, e) => s + e.cents, 0),
    chips,
    quiet: found.length === 0 && changed.length === 0,
    allGood:
      found.length === 0 &&
      changed.length === 0 &&
      open.length === 0 &&
      lines.every((l) => l.status !== "found"),
    checkup: {
      lines,
      found: count("found"),
      passed: count("passed"),
      notEnoughData: count("not_enough_data"),
    },
  };
}

// The month before and after (YYYY-MM), for the page's links.
export function monthStep(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}
