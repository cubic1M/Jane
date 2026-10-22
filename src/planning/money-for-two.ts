import { SPLIT_SUGGEST_GAP_BPS, type SplitRule } from "@/config/money-for-two";

// Money for two (spec step 242). Pure.

const FULL_BPS = 10_000;
export const HALF = 5_000;

// The partner's share of a shared bill under the household's rule, in basis points. By income
// it's the partner's part of what the two earn; half when either income isn't known.
export function partnerShareBps(rule: SplitRule, mineCents: number, partnerCents: number): number {
  if (rule === "even") return HALF;
  const total = mineCents + partnerCents;
  if (mineCents <= 0 || partnerCents <= 0 || total <= 0) return HALF;
  return Math.min(FULL_BPS - 100, Math.max(100, Math.round((partnerCents * FULL_BPS) / total)));
}

// Whether splitting by income would differ enough from half to be worth suggesting.
export const incomeSplitMatters = (shareBps: number) =>
  Math.abs(shareBps - HALF) >= SPLIT_SUGGEST_GAP_BPS;

// "60/40": the first person's share, then the other's.
export const sharesWords = (firstBps: number) =>
  `${Math.round(firstBps / 100)}/${100 - Math.round(firstBps / 100)}`;

// Whether a move needs both partners' taps: out of a shared account, of the household's
// big-move amount or more.
export const needsBothTaps = (fromShared: boolean, amountCents: number, limitCents: number) =>
  fromShared && amountCents >= limitCents;

// Two earners' pay, from deposits: each employer (the payroll's name) and what it paid. Pay
// from one employer is one earner; the two biggest are the couple.
export function twoEarners(
  deposits: readonly { description: string; cents: number }[],
): { first: { name: string; cents: number }; second: { name: string; cents: number } } | null {
  const by = new Map<string, number>();
  for (const d of deposits) {
    const name = d.description
      .replace(/\b(?:PAYROLL|DIR(?:ECT)? DEP(?:OSIT)?|PPD|ACH|SALARY)\b.*$/i, "")
      .trim();
    if (!name || d.cents <= 0) continue;
    by.set(name, (by.get(name) ?? 0) + d.cents);
  }
  const top = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (top.length < 2) return null;
  return {
    first: { name: top[0][0], cents: top[0][1] },
    second: { name: top[1][0], cents: top[1][1] },
  };
}
