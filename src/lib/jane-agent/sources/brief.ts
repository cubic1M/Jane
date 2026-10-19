import { BRIEF_BILL_DAYS, BRIEF_FROM_HOUR, MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { inDays, shortDate, things, type MessageSource } from "./source";

// The morning brief (spec step 82): once a day, from 7am in the person's timezone (or
// whenever they first open the chat that day). Safe to spend until payday, bills due in
// the next two days, and how many things wait on them. Fixed wording, no advice.

function greeting(hour: number): string {
  if (hour < 12) return "Good morning!";
  return hour < 17 ? "Good afternoon!" : "Good evening!";
}

export const briefSource: MessageSource = {
  key: "brief",
  gather(snapshot, { local, trigger }) {
    if (local.hour < BRIEF_FROM_HOUR && trigger !== "open") return [];
    const lines = [greeting(local.hour)];

    const safe = snapshot.safeToSpend;
    if (safe) {
      const until = safe.payday ? ` until payday on ${shortDate(safe.payday)}` : " this month";
      lines.push(
        safe.safeCents < 0
          ? `You're short by ${formatCents(-safe.safeCents)}${until}, after your bills.`
          : `You have ${formatCents(safe.safeCents)} safe to spend${until}.`,
      );
    }

    const bills = snapshot.comingUp.filter(
      (row) => row.href === "/bills" && row.daysLeft >= 0 && row.daysLeft <= BRIEF_BILL_DAYS,
    );
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

    return [
      {
        kind: "brief",
        body: lines.join("\n"),
        refs: {},
        actions: [{ id: "open", label: "See today", kind: "link", href: "/home" }],
        dedupeKey: local.date,
        priority: MESSAGE_PRIORITY.brief,
      },
    ];
  },
};
