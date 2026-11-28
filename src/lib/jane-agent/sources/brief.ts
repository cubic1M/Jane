import { personIsThere } from "../quiet-hours";
import { BRIEF_BILL_DAYS, BRIEF_FROM_HOUR, MESSAGE_PRIORITY } from "@/config/agent-chat";
import { DATA_ENDED_LINE } from "@/lib/data-ended";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { inDays, things, type MessageSource } from "./source";
import { rankedFor } from "../priorities";
import { lastWeekLine } from "./last-week";
import type { Snapshot } from "../snapshot";
import { openLink } from "../types";

// The morning brief (spec step 82): once a day, from 7am in the person's timezone (or
// whenever they first open the chat that day). Safe to spend until payday, bills due in
// the next two days, and how many things wait on them; on the first day of the week, how last
// week went (./last-week.ts). Fixed wording, no advice.

export function greeting(hour: number): string {
  if (hour < 12) return "Good morning!";
  return hour < 17 ? "Good afternoon!" : "Good evening!";
}

// When the person's data stopped weeks ago (the snapshot's dataEnded, from their own day), the brief
// and the day's agenda say so on a line of their own, so "no bills due, nothing waiting" is never
// read as an all-clear (debug 3, 11-16; it rode on the safe to spend line until that went).
export function dataEndedNotice(snapshot: Snapshot): string | null {
  return snapshot.dataEnded ? DATA_ENDED_LINE(dayLabel(snapshot.dataEnded)) : null;
}

// Bills due in the next BRIEF_BILL_DAYS days.
export const billsDueSoon = (snapshot: Snapshot) =>
  snapshot.comingUp.filter(
    (row) => row.href === "/bills" && row.daysLeft >= 0 && row.daysLeft <= BRIEF_BILL_DAYS,
  );

export const briefSource: MessageSource = {
  key: "brief",
  gather(snapshot, { now, local, trigger }) {
    if (local.hour < BRIEF_FROM_HOUR && !personIsThere(trigger)) return [];
    const lines = [greeting(local.hour)];
    const ended = dataEndedNotice(snapshot);
    if (ended) lines.push(ended);
    const week = lastWeekLine(snapshot, local, now);
    if (week) lines.push(week);

    const bills = billsDueSoon(snapshot);
    lines.push(
      bills.length === 0
        ? `No bills due in the next ${BRIEF_BILL_DAYS} days.`
        : `Bills due soon: ${bills
            .map(
              (b) =>
                `${b.label}${b.amountCents === null ? "" : ` ${formatCents(b.amountCents)}`} ${inDays(b.daysLeft)}`,
            )
            .join(", ")}.`,
    );

    const waiting = snapshot.plan.items + snapshot.waitingOnYou.length;
    lines.push(
      waiting === 0
        ? "Nothing is waiting on you. I'll keep watching."
        : `${things(waiting)} ${waiting === 1 ? "is" : "are"} waiting for you.`,
    );
    // Spec step 143: the one thing that matters most, and why.
    const [first] = rankedFor(snapshot);
    if (first) lines.push(`Start with: ${first.title}. ${first.why}`);

    return [
      {
        kind: "brief",
        body: lines.join("\n"),
        refs: {},
        actions: [openLink("See today", "/home")],
        dedupeKey: local.date,
        priority: MESSAGE_PRIORITY.brief,
      },
    ];
  },
};
