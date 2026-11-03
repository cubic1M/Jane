import {
  COMEBACK_MAX,
  NUDGE_AFTER_DAYS,
  NUDGE_EVERY_DAYS,
  NUDGE_MAX,
} from "@/config/follow-through";
import type { Watch } from "@/detectors/contract";
import { DAY_MS } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";

// Staying on a Yes until later data settles it (the controller's duty 6). Pure: one
// suggestion_outcomes row in, whether it needs a nudge or comes back, and the words. A nudge goes
// to a Yes with nothing done, and stops when the person acts or says no. A fix that failed (the
// window passed and the data shows no saving, or it came back) returns with its next step. A clean
// no never returns.

export type FollowRow = {
  answer: string | null;
  status: string;
  answeredAt: Date | null;
  doneAt: Date | null;
  nudgeCount: number;
  lastNudgedAt: Date | null;
  failedAt: Date | null;
  comebacks: number;
  comebackAt: Date | null;
};

// A Yes still waiting on the data or on the person.
export const OPEN_STATUSES: readonly string[] = ["open", "unverifiable"];
// A fix the data says failed.
export const FAILED_STATUSES: readonly string[] = ["not_seen", "lapsed"];

const daysSince = (from: Date, now: Date) => (now.getTime() - from.getTime()) / DAY_MS;

// A Yes with nothing done, past its wait, under the cap.
export function nudgeDue(row: FollowRow, now: Date): boolean {
  if (row.answer !== "yes" || !row.answeredAt || row.doneAt) return false;
  if (!OPEN_STATUSES.includes(row.status) || row.nudgeCount >= NUDGE_MAX) return false;
  if (daysSince(row.answeredAt, now) < NUDGE_AFTER_DAYS) return false;
  return !row.lastNudgedAt || daysSince(row.lastNudgedAt, now) >= NUDGE_EVERY_DAYS;
}

// This failure hasn't come back to the person yet, and it's under the cap.
export function comebackDue(row: FollowRow): boolean {
  if (row.answer !== "yes" || !FAILED_STATUSES.includes(row.status) || !row.failedAt) return false;
  if (row.comebacks >= COMEBACK_MAX) return false;
  return !row.comebackAt || row.comebackAt < row.failedAt;
}

// The failure has been told to the person: the nightly scan may offer it again (a clean no stays
// blocked, a Yes still open stays blocked, and so does a failure past the cap).
export function comesBack(row: FollowRow): boolean {
  if (row.answer !== "yes" || !FAILED_STATUSES.includes(row.status)) return false;
  return Boolean(row.failedAt && row.comebackAt && row.comebackAt >= row.failedAt);
}

// What to try next, by what was being watched. Steps the person takes; no advice on what to buy.
export function nextStepOf(watch: Watch | null): string | null {
  if (!watch) return null;
  switch (watch.kind) {
    case "charge_stops":
      return "Check your account with them shows it as cancelled. If it does, ask them for the charge back, and if it still won't stop, ask your card or bank to block it.";
    case "bill_drops":
      return "Ask them if the lower price went through, and when it starts. A new price can take one bill to show.";
    case "refund":
      return "Ask them when it was sent and for a reference number, then check that with your bank.";
    case "fee_stops":
      return "Ask the bank to take back the latest fee, and ask what sets it off so you can avoid it.";
    case "funds_left":
    case "cash_invested":
    case "account_closed":
      return "Check the order or transfer went through with the company that holds the account.";
  }
}

// Why it's back, from what the data showed: "You said yes on Sep 3. Still charged: $15.99 on Oct
// 30. Next: ...".
// actedOn: the person's own day they acted (YYYY-MM-DD).
export function comebackWords(row: {
  actedOn: string | null;
  doneAt: Date | null;
  status: string;
  proof: string | null;
  heldProof: string | null;
  watch: Watch | null;
}): string {
  const said = row.doneAt ? "You did it" : "You said yes";
  const shown = row.status === "lapsed" ? (row.heldProof ?? row.proof) : row.proof;
  const next = nextStepOf(row.watch);
  return [
    `${said}${row.actedOn ? ` on ${dayLabel(row.actedOn)}` : ""}, and it didn't hold.`,
    shown,
    next ? `Next: ${next}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

// The nudge's words, with the person's own day they said yes (YYYY-MM-DD).
export function nudgeWords(title: string, answeredOn: string): string {
  const name = title.trim().replace(/[.!]+$/, "");
  return `You said yes to "${name}" on ${dayLabel(answeredOn)}. Done it yet? Tell me and I'll check it against your next statement. Changed your mind? Say so and I'll drop it.`;
}
