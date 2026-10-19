import type { Debt } from "@/insights/debts";

// Rates watched (spec step 117): each rate the bank reports, against the one Jane saw last
// time. Pure.

export type RateChange = {
  debtKey: string;
  name: string;
  fromBps: number;
  toBps: number;
  on: string;
};

// Pure: what changed between the rates Jane saw last time and the bank's now. A debt seen
// for the first time is noted, not a change.
export function rateChanges(
  seen: Readonly<Record<string, number>>,
  debts: readonly Debt[],
  on: string,
): { rates: Record<string, number>; changes: RateChange[] } {
  const rates: Record<string, number> = { ...seen };
  const changes: RateChange[] = [];
  for (const d of debts) {
    if (d.aprFrom !== "bank" || d.aprBps === null) continue;
    const before = seen[d.key];
    if (before !== undefined && before !== d.aprBps) {
      changes.push({ debtKey: d.key, name: d.name, fromBps: before, toBps: d.aprBps, on });
    }
    rates[d.key] = d.aprBps;
  }
  return { rates, changes };
}
