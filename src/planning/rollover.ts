import { ROLLOVER_DAYS, ROLLOVER_STEPS } from "@/config/old-accounts";
import { addDays } from "@/lib/dates";

// Old accounts brought home (spec step 211). Pure: the fees before and after a rollover,
// and the tracked steps. A rollover is never a withdrawal.

export type Step = { key: string; label: string; doneOn: string | null };

// Yearly fees on a balance at an expense ratio, in cents.
export const yearlyFee = (balanceCents: number, bps: number) =>
  Math.round((balanceCents * bps) / 10_000);

export function feeComparison(input: { balanceCents: number; oldBps: number; newBps: number }) {
  const before = yearlyFee(input.balanceCents, input.oldBps);
  const after = yearlyFee(input.balanceCents, input.newBps);
  return { beforeCents: before, afterCents: after, savedCents: before - after };
}

// 401(k)s the person has linked from past jobs: every linked 401(k) but the biggest (taken as the
// current job's), and what rolling them over would save at a typical old-plan fee gap. One rule
// for the "old accounts" suggestion, its page and the chat, so their figures agree.
export type LinkedPlan = { id: string; name: string; balanceCents: number };
export function olderPlans(plans: readonly LinkedPlan[], gapBps: number) {
  const older = [...plans]
    .sort((a, b) => b.balanceCents - a.balanceCents)
    .slice(1)
    .filter((p) => p.balanceCents > 0);
  const totalCents = older.reduce((s, p) => s + p.balanceCents, 0);
  return {
    plans: older,
    count: plans.length,
    totalCents,
    savedCents: yearlyFee(totalCents, gapBps),
  };
}

export const newSteps = (): Step[] => ROLLOVER_STEPS.map((s) => ({ ...s, doneOn: null }));

// The steps as they stand on `today`, given when the rollover was requested: the first two
// are done at once, the money arrives ROLLOVER_DAYS later, and is invested the same day.
export function stepsOn(requestedOn: string, today: string): Step[] {
  const arrives = addDays(requestedOn, ROLLOVER_DAYS);
  const landed = today >= arrives;
  return newSteps().map((s) => ({
    ...s,
    doneOn: s.key === "destination" || s.key === "request" ? requestedOn : landed ? arrives : null,
  }));
}

export const isComplete = (steps: Step[]) => steps.every((s) => s.doneOn !== null);
export const arrivesOn = (requestedOn: string) => addDays(requestedOn, ROLLOVER_DAYS);
