import { COSTLY_LABELS, COSTLY_SOURCES, EMPLOYER_ADVANCE } from "@/config/costly-borrowing";
import type { CostlyBorrowing } from "@/lib/costly-borrowing";
import { formatCents } from "@/lib/money";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";
import { formatRate } from "@/lib/percent";

// Jane's answers about costly short-term borrowing (spec step 247), from
// src/lib/costly-borrowing.ts. Pure. What was found and what it cost are facts from the
// payments; the cheaper ways out are demo advice.

export const COSTLY_PAGE: MessageAction = {
  id: "open",
  label: "Your costly borrowing",
  kind: "link",
  href: "/loans/costly",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function foundLines(d: CostlyBorrowing): string[] {
  return d.kinds.map(
    (k) =>
      `- ${COSTLY_LABELS[k.kind]}: ${plural(k.count, "time", "times")}, ${formatCents(k.costCents)} in fees${k.aprBps !== null ? `, about ${formatRate(k.aprBps)} a year` : ""} (${k.basis}).`,
  );
}

export function wayOutLines(d: CostlyBorrowing): string[] {
  const a = d.alternatives;
  return [
    `- ${a.pal.label}: ${formatCents(a.pal.amountCents)} over ${a.pal.termMonths} months at up to ${formatRate(a.pal.aprBps)}, ${formatCents(a.pal.paymentCents)} a month, ${formatCents(a.pal.totalCostCents)} in interest and fees in all. A payday loan on the same amount costs about ${formatCents(a.pal.paydayFeeCents)} every two weeks.`,
    `- ${EMPLOYER_ADVANCE.label}: ${a.employer}`,
    `- A buffer: set aside ${formatCents(a.buffer.monthlyCents)} a month and you'd have ${formatCents(a.buffer.targetCents)} in ${a.buffer.months} months, so the next gap before payday doesn't need a loan.`,
  ];
}

export function costlyReply(d: CostlyBorrowing): Reply {
  if (!d.any) {
    return {
      body: "I don't see payday loans, card cash advances, repeated overdrafts or pay advance apps costing you much in the last year of your payments.",
      actions: [COSTLY_PAGE],
      refs: {},
    };
  }
  const lines = [
    `Costly short-term borrowing cost you ${formatCents(d.totalYearlyCents)} over the last year, across ${plural(d.kinds.length, "kind", "kinds")}.`,
    ...foundLines(d),
  ];
  if (d.cycle) {
    lines.push(
      "You've borrowed again within a few months, which is the cycle that's hard to leave: each loan's fee comes out of the money you'd need next time.",
    );
  }
  if (d.advice) {
    lines.push(
      "Cheaper ways out:",
      ...wayOutLines(d),
      "To stop the cycle:",
      ...d.steps.map((s) => `- ${s}`),
    );
  }
  lines.push(`Sources: ${COSTLY_SOURCES.map((s) => s.label).join("; ")}.`);
  return { body: lines.join("\n"), actions: [COSTLY_PAGE], refs: d.advice ? { advice: true } : {} };
}
