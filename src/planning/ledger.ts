import {
  FEE_COMPARE_DAYS,
  HELD_DAYS,
  LOWER_BILL_SHARE,
  REFUND_MIN_SHARE,
  STOP_GRACE_DAYS,
  WATCH_DAYS,
} from "@/config/outcomes";
import type { Watch } from "@/detectors/contract";
import { dayLabel } from "@/lib/day-label";
import type { CheckDay } from "./outcomes";

// The savings ledger's states (the verified savings record, src/lib/ledger.ts). Each finding the
// person saw is in one of them, and only Verified and Held count toward "saved":
// - Estimated: Jane found it; the person hasn't acted.
// - Done: the person said they did it ("I did it"); not in their transactions yet.
// - Verified: a later statement, upload or bank sync shows it, with the lines that show it.
// - Held: still true HELD_DAYS after it was verified.
// - Not seen: the watch window passed with no saving, or it came back after it was verified.
// Pure.

export type LedgerState = "estimated" | "done" | "verified" | "held" | "not_seen";

export const LEDGER_STATES: readonly LedgerState[] = [
  "held",
  "verified",
  "done",
  "estimated",
  "not_seen",
];

export const STATE_LABEL: Record<LedgerState, string> = {
  estimated: "Estimated",
  done: "Done",
  verified: "Verified",
  held: "Held",
  not_seen: "Not seen",
};

// The headline counts these only.
export const COUNTED: readonly LedgerState[] = ["verified", "held"];

// A suggestion_outcomes row's state. Null for a no (declined): not on the ledger.
export function ledgerStateOf(row: {
  status: string;
  heldAt?: Date | string | null;
}): LedgerState | null {
  switch (row.status) {
    case "shown":
      return "estimated";
    case "open":
    case "unverifiable":
      return "done";
    case "confirmed":
    case "partial":
      return row.heldAt ? "held" : "verified";
    case "not_seen":
    case "lapsed":
      return "not_seen";
    default:
      return null;
  }
}

const pct = (share: number) => `${Math.round(share * 100)}%`;

// How each kind of saving is verified, shown beside it: the rule, in the person's words, with
// the numbers from src/config/outcomes.ts.
export function verifyRule(watch: Watch | null): string {
  if (!watch) return "Stays an estimate: your transactions can't show this one.";
  switch (watch.kind) {
    case "charge_stops":
      return `Verified when the next charge was due, plus ${STOP_GRACE_DAYS} days for the bank, and a newer statement shows none.`;
    case "bill_drops":
      return `Verified when a bill from the same company comes in at least ${pct(1 - LOWER_BILL_SHARE)} lower.`;
    case "refund":
      return `Verified when at least ${pct(REFUND_MIN_SHARE)} of the money comes back from them.`;
    case "fee_stops":
      return `Verified when ${FEE_COMPARE_DAYS} days of statements after you acted show fewer fees than before.`;
    case "funds_left":
      return "Verified when your holdings show the fund sold.";
    case "cash_invested":
      return "Verified when your holdings show the cash invested.";
    case "account_closed":
      return "Verified when your holdings show the account closed.";
  }
}

export const HELD_RULE = `Held when it is still true ${HELD_DAYS} days after it was verified, on statements that reach that far.`;

export function notSeenRule(watch: Watch | null): string {
  return watch
    ? `Not seen when ${WATCH_DAYS[watch.kind]} days pass with no saving, or it comes back after it was verified.`
    : "";
}

// The rules as a short list for the page's "How Jane verifies" note.
export const LEDGER_RULES: readonly string[] = [
  "Saved counts Verified and Held only. Estimates are never added in.",
  "A stopped charge counts only once a statement after its due day shows nothing.",
  "A lower bill or a refund counts from the transaction that shows it.",
  HELD_RULE,
  "Where your transactions can't show a saving, it stays an estimate.",
];

// The words for a Done saving's check day, as of today: "we'll check on Nov 5"; once the day has
// passed with no statement after it, that one is what's missing; a refund is watched for until a
// day.
export function checkWords(check: CheckDay | null, today: string): string | null {
  if (!check) return null;
  const day = dayLabel(check.on);
  if (check.until) return `we'll watch for it until ${day}`;
  return check.on >= today
    ? `we'll check on ${day}`
    : `we'll check once a statement after ${day} is in`;
}
