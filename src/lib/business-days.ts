// Monday to Friday, in UTC. Holidays aren't counted; the queue only uses this to flag
// actions that are probably overdue.

function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const weekday = d.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return d;
}

export function isOverdue(since: Date, businessDays: number, now: Date): boolean {
  return now > addBusinessDays(since, businessDays);
}
