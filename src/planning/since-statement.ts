import { dayLabel } from "@/lib/day-label";
import { formatWholeDollars } from "@/lib/money";

export type SinceStatement = { day: string; cents: number };

// A balance walked forward from a statement is an estimate, and says so with what it added
// (debugger 11-19: "In checking now $3,879" counted pay a statement ending Nov 12 doesn't show,
// beside its $2,310.55 everywhere else).
export function sinceStatementNote(since: SinceStatement): string {
  const sign = since.cents < 0 ? "−" : "+";
  return `${sign}${formatWholeDollars(Math.abs(since.cents))} of pay and bills expected since your ${dayLabel(since.day)} statement`;
}
