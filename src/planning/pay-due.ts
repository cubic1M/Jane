import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";

// A paycheck into checking, due on `dueOn`, that hasn't come in (src/planning/safe-to-spend.ts).
export type PayDue = { employer: string; cents: number; dueOn: string };

// Pay due today, or a day ago and still expected, counts in safe to spend as a bill due today does,
// and is said as expected: the balance doesn't have it yet (phone debugger, 11-20).
export const payDueLabel = (p: PayDue) =>
  `${p.employer} pay due ${dayLabel(p.dueOn)}, expected, not in yet`;
export const PAY_DUE_NOTE =
  "Counted on the day it's due, as bills due that day are; it isn't in your balance yet";

// Pay that didn't come in once the wait ran out: not counted, and said so rather than gone.
export const payMissedLabel = (p: PayDue) =>
  `Not counted: ${p.employer} pay due ${dayLabel(p.dueOn)}, which hasn't come in`;

// The same, as a sentence for the chat.
export function payDueSentence(due: PayDue[], missed: PayDue[]): string {
  const said = (p: PayDue) => `${p.employer}'s ${formatCents(p.cents)} due ${dayLabel(p.dueOn)}`;
  return [
    ...due.map((p) => ` That counts ${said(p)}, which isn't in checking yet.`),
    ...missed.map((p) => ` It doesn't count ${said(p)}, which hasn't come in.`),
  ].join("");
}
