import { PAY_EXTRA_MIN_SHARE, PAYCHECKS_PER_MONTH, PAYDAY_POSTING_DAYS } from "@/config/detection";
import { addDays } from "@/lib/dates";
import { inLookback } from "@/detection/helpers";
import {
  paychecksByEmployer,
  paySchedules,
  schedulePaydays,
  type PaySchedule,
} from "@/detection/paydays";
import type { DetectionInput } from "@/detection/types";
import type { ProfileTx } from "./build";

// One employer's pay on its schedule: its usual paycheck and what the schedule makes of it a month.
export type PayOnSchedule = {
  employer: string;
  frequency: PaySchedule["frequency"];
  paycheckCents: number;
  monthCents: number;
  // Pay beyond the usual paychecks in the lines: a deposit on a day the schedule doesn't pay, and
  // what a payday brought over the usual paycheck by PAY_EXTRA_MIN_SHARE or more (a bonus). Not in
  // a month; a year adds it once.
  extraCents: number;
};

// Pay that comes on a schedule, as a month: each employer still paying on one (weekly, every two
// weeks, twice a month, monthly; src/detection/paydays.ts) gives its usual paycheck times the
// paychecks that schedule brings a month. Divided by the months of data instead, the count of
// paydays a window happens to hold set the figure: one month's file with three paychecks every two
// weeks read as three a month, 38% high (debug 3, upload S5, 11-19). `covered` is the lines it
// counted, older ones from the same employer included; the rest are left to the caller's own
// division. A bonus among them is in `extraCents`, not the month. Pure.
export function payOnSchedule(
  lines: readonly ProfileTx[],
  // Where the data ends: whether an employer still pays is counted from there.
  asOf: string,
): {
  monthCents: number;
  extraCents: number;
  covered: Set<ProfileTx>;
  schedules: PayOnSchedule[];
} {
  const input = inputOf(lines, asOf);
  const groups = new Map(paychecksByEmployer(input).map((g) => [`employer:${g.key}`, g]));
  // The paychecks the schedule was found from: an older one (before a raise) doesn't set the usual.
  const recent = new Set(inLookback(input).map((t) => t.id));
  const covered = new Set<ProfileTx>();
  const schedules: PayOnSchedule[] = [];
  for (const schedule of paySchedules(input)) {
    const group = groups.get(schedule.key);
    if (!schedule.active || !group) continue;
    for (const t of group.deposits) covered.add(lines[Number(t.id)]!);
    const paycheckCents = usualPaycheck(group.deposits, recent);
    schedules.push({
      employer: schedule.employer,
      frequency: schedule.frequency,
      paycheckCents,
      monthCents: Math.round(paycheckCents * PAYCHECKS_PER_MONTH[schedule.frequency]),
      extraCents: extraPay(schedule, group.deposits, paycheckCents),
    });
  }
  return {
    monthCents: schedules.reduce((s, p) => s + p.monthCents, 0),
    extraCents: schedules.reduce((s, p) => s + p.extraCents, 0),
    covered,
    schedules,
  };
}

// A year's pay so far and still to come, from employers that pay on a schedule: each paycheck in
// `paid` (this year's lines) once, from every employer with a schedule, still paying or not, and
// each one still paying's usual paycheck on the paydays its schedule has left after its latest one
// through `yearEnd`. Paced by the months the data covers instead, the paydays those months happen
// to hold set the year: 20 paychecks twice a month by Oct 23 paced to 24.68 a year, 2.8% high (the
// renter, gate C 11-20), and 12 by June 20 to 25.6. `covered` is the lines it counted; the rest
// (pay with no schedule) are left to the caller's pace. `history` is every line to find the
// schedules from, `paid` among them. Pure.
export function payForYear(
  history: readonly ProfileTx[],
  paid: readonly ProfileTx[],
  asOf: string,
  yearEnd: string,
): { paidCents: number; leftCents: number; covered: Set<ProfileTx> } {
  const input = inputOf(history, asOf);
  const groups = new Map(paychecksByEmployer(input).map((g) => [`employer:${g.key}`, g]));
  const recent = new Set(inLookback(input).map((t) => t.id));
  const scheduled = new Set<ProfileTx>();
  let leftCents = 0;
  for (const schedule of paySchedules(input)) {
    const group = groups.get(schedule.key);
    if (!group) continue;
    for (const t of group.deposits) scheduled.add(history[Number(t.id)]!);
    if (!schedule.active) continue;
    const left = schedulePaydays(
      schedule,
      addDays(schedule.lastDate, PAYDAY_POSTING_DAYS + 1),
      yearEnd,
    ).length;
    leftCents += left * usualPaycheck(group.deposits, recent);
  }
  const covered = new Set(paid.filter((t) => scheduled.has(t)));
  return {
    paidCents: [...covered].reduce((s, t) => s - t.amountCents, 0),
    leftCents,
    covered,
  };
}

function inputOf(lines: readonly ProfileTx[], asOf: string): DetectionInput {
  return {
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
}

// The usual paycheck from the recent ones: a paycheck split between accounts on one day is one.
function usualPaycheck(
  deposits: readonly { id: string; date: string; amountCents: number }[],
  recent: ReadonlySet<string>,
): number {
  const byDay = new Map<string, number>();
  for (const t of deposits)
    if (recent.has(t.id)) byDay.set(t.date, (byDay.get(t.date) ?? 0) - t.amountCents);
  return median([...byDay.values()]);
}

// What an employer paid beyond its usual paychecks, over all its lines.
function extraPay(
  schedule: PaySchedule,
  deposits: readonly { date: string; amountCents: number }[],
  paycheckCents: number,
): number {
  const byDay = new Map<string, number>();
  for (const t of deposits) byDay.set(t.date, (byDay.get(t.date) ?? 0) - t.amountCents);
  const days = [...byDay.keys()].sort();
  const paydays = new Set(
    schedulePaydays(
      schedule,
      addDays(days[0]!, -PAYDAY_POSTING_DAYS),
      addDays(days.at(-1)!, PAYDAY_POSTING_DAYS),
    ),
  );
  const near = (day: string) => {
    for (let off = -PAYDAY_POSTING_DAYS; off <= PAYDAY_POSTING_DAYS; off += 1)
      if (paydays.has(addDays(day, off))) return true;
    return false;
  };
  let extra = 0;
  for (const [day, cents] of byDay) {
    if (!near(day)) extra += cents;
    else if (cents >= paycheckCents * (1 + PAY_EXTRA_MIN_SHARE)) extra += cents - paycheckCents;
  }
  return extra;
}

// The usual paycheck: a bonus or a short week doesn't move it.
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
