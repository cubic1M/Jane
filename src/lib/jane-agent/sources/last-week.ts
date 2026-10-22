import { formatCents } from "@/lib/money";
import type { LocalTime } from "../quiet-hours";
import { weekDone } from "../replies-review";
import type { Snapshot } from "../snapshot";
import { shortDate } from "./source";

// How last week went, as one line of the morning brief on the first day of the person's week.
// It replaces two weekly messages of their own (docs/feature-audit.md, cluster 2): the week's
// summary (spec step 96: what was asked and decided) and the weekly review (spec step 101:
// what Jane did and what it saved). What's next and the one decision are the brief's own
// lines already. Null on other days, and after a week with nothing in it. Pure.

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function lastWeekLine(snapshot: Snapshot, local: LocalTime, now: Date): string | null {
  if (local.date !== snapshot.weekStart) return null;
  const { did, savedCents } = weekDone(snapshot, now);
  const week = snapshot.lastWeek;
  const covered = week
    ? [
        week.asked > 0 ? count(week.asked, "question you asked", "questions you asked") : null,
        week.yes + week.no > 0
          ? `${count(week.yes + week.no, "decision")} (${week.yes} yes, ${week.no} no)`
          : null,
      ].filter(Boolean)
    : [];
  const parts = [
    did.length > 0 ? `I ${did.join("; ")}` : null,
    savedCents > 0 ? `${formatCents(savedCents)} was confirmed back or saved` : null,
    covered.length > 0 ? `we covered ${covered.join(" and ")}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const since = week ? `The week of ${shortDate(week.start)}` : "Last week";
  return `${since}: ${parts.join("; ")}.`;
}
