import { PFC_TAXONOMY, type PfcDetailed, type PfcPrimary } from "@/categorize/taxonomy";
import { addDays } from "@/lib/dates";

// What the demo bank (./demo-bank.ts) and its sample people (./demo-people.ts) both build on:
// the seed, a seeded random number, account ids and month days. Pure.

// The anchor is the day the demo bank was linked; one-off events are placed around it so
// they always look recent on the first scan.
export type DemoSeed = {
  seed: string;
  anchor: string;
  // Spec step 252: which sample person this bank is (src/config/people.ts); the original
  // demo bank when left out.
  person?: string;
  // Books QA: a second bank login of the same person (demo-people.ts DEMO_SECOND_LOGINS),
  // which sees just the one account they share.
  login?: string;
};

// A small seeded random number in [0, 1), so amounts vary but never change between syncs.
export function random(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h += 0x6d2b79f5;
  let t = h;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const primaryOf = (detailed: PfcDetailed): PfcPrimary =>
  (Object.keys(PFC_TAXONOMY) as PfcPrimary[]).find((p) =>
    (PFC_TAXONOMY[p] as readonly string[]).includes(detailed),
  )!;

export type AccountKey =
  | "checking"
  | "savings"
  | "card"
  | "mortgage"
  | "student"
  | "auto"
  | "retirement"
  | "brokerage"
  // Spec step 159: a demo HSA, only when the person links one (DemoExtra).
  | "hsa"
  // Spec step 160: a demo employer stock plan (vested RSUs).
  | "stock_plan"
  // Spec step 210: a demo Roth IRA.
  | "roth_ira"
  // Spec step 211: a demo traditional IRA to roll an old 401(k) into.
  | "rollover_ira"
  // Spec step 213: a child's demo custodial account and Roth IRA.
  | "custodial"
  | "child_roth";

export const accountId = (seed: string, key: AccountKey | (string & {})) => `demo-${seed}-${key}`;

export const lastDayOfMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

// The next time a day of the month comes round, after `today`.
export function nextDayOfMonth(today: string, dayOfMonth: number): string {
  for (let i = 1; i <= 31; i += 1) {
    const day = addDays(today, i);
    if (Number(day.slice(8)) === dayOfMonth) return day;
  }
  return addDays(today, 30);
}

// The last time a day of the month came round, on or before `today`.
export function lastDayOfMonthOn(today: string, dayOfMonth: number): string {
  for (let i = 0; i <= 31; i += 1) {
    const day = addDays(today, -i);
    if (Number(day.slice(8)) === dayOfMonth) return day;
  }
  return addDays(today, -30);
}
