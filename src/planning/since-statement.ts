import { dayLabel } from "@/lib/day-label";
import { formatCents, formatWholeDollars } from "@/lib/money";

export type SinceStatement = { day: string; cents: number };

// A balance walked forward from a statement is an estimate, and says so with what it added
// (debugger 11-19: "In checking now $3,879" counted pay a statement ending Nov 12 doesn't show,
// beside its $2,310.55 everywhere else).
export function sinceStatementNote(since: SinceStatement): string {
  const sign = since.cents < 0 ? "−" : "+";
  return `${sign}${formatWholeDollars(Math.abs(since.cents))} of pay and bills expected since your ${dayLabel(since.day)} statement`;
}

// A cash place as it's said: its balance, or checking walked forward to today, "estimated", with
// what it added (the cash page, the chat's cash answer and its tool; debug 3, 11-19).
export function placeLine(p: {
  name: string;
  balanceCents: number;
  today?: { cents: number; since: SinceStatement };
}): string {
  return p.today
    ? `${formatCents(p.today.cents)} in ${p.name} (estimated: ${sinceStatementNote(p.today.since)})`
    : `${formatCents(p.balanceCents)} in ${p.name}`;
}
