import { PAYCHECKS_PER_MONTH } from "@/config/detection";
import { inLookback } from "@/detection/helpers";
import { paychecksByEmployer, paySchedules, type PaySchedule } from "@/detection/paydays";
import type { DetectionInput } from "@/detection/types";
import type { ProfileTx } from "./build";

// One employer's pay on its schedule: its usual paycheck and what the schedule makes of it a month.
export type PayOnSchedule = {
  employer: string;
  frequency: PaySchedule["frequency"];
  paycheckCents: number;
  monthCents: number;
};

// Pay that comes on a schedule, as a month: each employer still paying on one (weekly, every two
// weeks, twice a month, monthly; src/detection/paydays.ts) gives its usual paycheck times the
// paychecks that schedule brings a month. Divided by the months of data instead, the count of
// paydays a window happens to hold set the figure: one month's file with three paychecks every two
// weeks read as three a month, 38% high (debug 3, upload S5, 11-19). `covered` is the lines it
// counted, older ones from the same employer included; the rest are left to the caller's own
// division. Pure.
export function payOnSchedule(
  lines: readonly ProfileTx[],
  // Where the data ends: whether an employer still pays is counted from there.
  asOf: string,
): { monthCents: number; covered: Set<ProfileTx>; schedules: PayOnSchedule[] } {
  const input: DetectionInput = {
    asOf,
    accounts: [],
    recurringStreams: [],
    transactions: lines.map((t, i) => ({
      id: String(i),
      accountId: t.accountId,
      plaidTransactionId: null,
      date: t.date,
      amountCents: t.amountCents,
      description: t.description,
      merchantName: t.merchantName ?? null,
      pfcPrimary: null,
      pfcDetailed: t.pfc,
      categorySource: null,
    })),
  };
  const groups = new Map(paychecksByEmployer(input).map((g) => [`employer:${g.key}`, g]));
  // The paychecks the schedule was found from: an older one (before a raise) doesn't set the usual.
  const recent = new Set(inLookback(input).map((t) => t.id));
  const covered = new Set<ProfileTx>();
  const schedules: PayOnSchedule[] = [];
  for (const schedule of paySchedules(input)) {
    const group = groups.get(schedule.key);
    if (!schedule.active || !group) continue;
    // A paycheck split between accounts on one day is one paycheck.
    const byDay = new Map<string, number>();
    for (const t of group.deposits) {
      covered.add(lines[Number(t.id)]!);
      if (recent.has(t.id)) byDay.set(t.date, (byDay.get(t.date) ?? 0) - t.amountCents);
    }
    const paycheckCents = median([...byDay.values()]);
    schedules.push({
      employer: schedule.employer,
      frequency: schedule.frequency,
      paycheckCents,
      monthCents: Math.round(paycheckCents * PAYCHECKS_PER_MONTH[schedule.frequency]),
    });
  }
  return { monthCents: schedules.reduce((s, p) => s + p.monthCents, 0), covered, schedules };
}

// The usual paycheck: a bonus or a short week doesn't move it.
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
