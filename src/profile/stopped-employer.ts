import { EARNER_ACTIVE_DAYS, SALARY_DEPOSITS_MIN } from "@/config/profile";
import { addDays } from "@/lib/dates";

// The employer whose paychecks stopped, going by where the data ends: an old statement isn't a lost
// job. Null with pay still coming, or too few paychecks to call it a job. Pure.
export function stoppedEmployer(data: {
  transactions: readonly {
    date: string;
    amountCents: number;
    description: string;
    pfc?: string | null;
  }[];
}): {
  name: string;
  lastDay: string;
  paychecks: number;
} | null {
  const last = new Map<string, string>();
  const paid = new Map<string, number>();
  for (const t of data.transactions) {
    if (t.amountCents >= 0 || t.pfc !== "INCOME_SALARY") continue;
    const name = t.description.replace(/\s+PAYROLL.*$/i, "").trim();
    if ((last.get(name) ?? "") < t.date) last.set(name, t.date);
    paid.set(name, (paid.get(name) ?? 0) + 1);
  }
  if (last.size === 0) return null;
  const dataEnds = data.transactions.reduce((m, t) => (t.date > m ? t.date : m), "");
  const stillPaidSince = addDays(dataEnds, -EARNER_ACTIVE_DAYS);
  const [name, lastDay] = [...last].sort((a, b) => b[1].localeCompare(a[1]))[0];
  const paychecks = paid.get(name) ?? 0;
  return lastDay > stillPaidSince || paychecks < SALARY_DEPOSITS_MIN
    ? null
    : { name, lastDay, paychecks };
}
