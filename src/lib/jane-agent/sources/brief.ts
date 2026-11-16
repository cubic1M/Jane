import { personIsThere } from "../quiet-hours";
import { BRIEF_BILL_DAYS, BRIEF_FROM_HOUR, MESSAGE_PRIORITY } from "@/config/agent-chat";
import { DATA_ENDED_LINE } from "@/lib/data-ended";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { dateAndDays, inDays, things, type MessageSource } from "./source";
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

// Safe to spend until payday, as the brief and the day's agenda (spec step 184) say it. After
// statements that ended weeks ago, first that it may be out of date, as the chat says it (debug 3,
// 11-16: an upload ending Oct 14 gave "Good morning! You have $5,468.72 safe to spend" each day).
export function safeLine(snapshot: Snapshot, date: string): string | null {
  const line = safeAmountLine(snapshot, date);
  if (!line || !snapshot.dataEnded) return line;
  return `${DATA_ENDED_LINE(dayLabel(snapshot.dataEnded))} ${line}`;
}

function safeAmountLine(snapshot: Snapshot, date: string): string | null {
  const safe = snapshot.safeToSpend;
  if (!safe) return null;
  const until = safe.payday ? ` until payday, ${dateAndDays(safe.payday, date)}` : " this month";
  return safe.safeCents < 0
    ? `You're short by ${formatCents(-safe.safeCents)}${until}, after your bills.`
    : `You have ${formatCents(safe.safeCents)} safe to spend${until}${
        safe.taxHeldCents ? `, after holding back ${formatCents(safe.taxHeldCents)} for tax` : ""
      }.`;
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
    const safe = safeLine(snapshot, local.date);
    if (safe) lines.push(safe);
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
