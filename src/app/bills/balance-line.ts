import { formatCents } from "@/lib/money";

// The account's balance as /bills says it: today's, or a statement's with its day, and then
// what it comes to today only when something was due since (debugger 10-31: "$6,210.40 on Oct
// 29, about $6,210.40 today" said one number twice).
export function balanceLine(
  f: { startOn: string; startCents: number; todayCents: number; days: { date: string }[] },
  dayLabel: (iso: string) => string,
): string {
  if (f.startOn === f.days[0]?.date) return `${formatCents(f.startCents)} today`;
  const on = `${formatCents(f.startCents)} on ${dayLabel(f.startOn)}`;
  return f.todayCents === f.startCents ? on : `${on}, about ${formatCents(f.todayCents)} today`;
}
