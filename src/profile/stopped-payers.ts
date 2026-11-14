import { EARNER_ACTIVE_DAYS } from "@/config/profile";
import { addDays } from "@/lib/dates";
import { payerKeyOf } from "@/planning/tax-corrections";

// "Has this paycheck stopped?", answered once for the profile, the stopped-job card and the tax
// estimate. A payer is keyed by payerKeyOf, the key the tax estimate and its corrections use: the
// profile had keyed by employerName, which keeps a bank's per-deposit date ("DIRECT DEP
// SPRINGFIELD SCHOOLS 102025"), so one job read as six earners while the tax estimate saw one
// payer (debugger 11-14, from the simplify pass). A payer's pay has stopped when its last deposit is
// EARNER_ACTIVE_DAYS or more before the data ends: an old statement isn't a lost job. Pure.

export const payKeyOf = payerKeyOf;

type PayRow = { date: string; description: string };

// Each payer's latest deposit, by key.
export function latestByPayer<T extends PayRow>(rows: readonly T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const t of rows) {
    const key = payKeyOf(t.description);
    if ((latest.get(key)?.date ?? "") < t.date) latest.set(key, t);
  }
  return latest;
}

// The payers whose pay has stopped by `dataEnds` (the last day in the data). None without a day.
export function stoppedPayers(rows: readonly PayRow[], dataEnds: string): Set<string> {
  if (!dataEnds) return new Set();
  const stillPaidSince = addDays(dataEnds, -EARNER_ACTIVE_DAYS);
  return new Set(
    [...latestByPayer(rows)].filter(([, t]) => t.date <= stillPaidSince).map(([key]) => key),
  );
}
