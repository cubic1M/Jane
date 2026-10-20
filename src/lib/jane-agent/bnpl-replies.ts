import { BNPL_EARLY_PAYOFF_SOURCE } from "@/config/bnpl";
import { LOW_BALANCE_CUSHION_CENTS } from "@/config/detection";
import type { Bnpl } from "@/lib/bnpl";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { warnNewPlan } from "@/planning/bnpl";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about buy now, pay later (spec step 176), from src/lib/bnpl.ts. Pure.

export const BNPL_PAGE: MessageAction = {
  id: "open",
  label: "See every debt",
  kind: "link",
  href: "/loans",
};

export const payoffButton = (name: string): MessageAction => ({
  id: "bnpl.payoff",
  label: `Pay off the ${name}`,
  kind: "primary",
});

export const installmentLines = (data: Bnpl, limit = 6) =>
  data.installments
    .slice(0, limit)
    .map((i) => `- ${dayLabel(i.date)}: ${formatCents(i.cents)} to ${i.name}`);

const unavailable: Reply = {
  body: "I don't see any buy now, pay later plans in your payments. If you start one, I'll add its installments to your forecast.",
  actions: [],
  refs: {},
};

// "What buy now pay later payments do I have coming?"
export function bnplReply(data: Bnpl): Reply {
  if (data.plans.length === 0) return unavailable;
  const total = data.installments.reduce((s, i) => s + i.cents, 0);
  const missing = data.missing.reduce((s, i) => s + i.cents, 0);
  const lines = [
    `You have ${data.plans.length} buy now, pay later ${data.plans.length === 1 ? "plan" : "plans"}, with ${formatCents(total)} in installments over the next month:`,
    ...installmentLines(data),
  ];
  if (missing > 0) {
    lines.push(
      `${formatCents(missing)} of that isn't in your forecast yet, so I take it off your safe to spend.`,
    );
  }
  const free = data.plans.find((p) => p.freePayoff && p.canCoverPayoff && !p.payoffScheduled);
  if (free) {
    lines.push(
      `Paying off the ${free.name} now (${formatCents(free.balanceCents!)}) costs nothing extra: Pay in 4 plans charge no interest or fee for paying early.`,
    );
  }
  return {
    body: lines.join("\n"),
    actions: free ? [payoffButton(free.name), BNPL_PAGE] : [BNPL_PAGE],
    refs: free ? { advice: true, bnplPlan: { key: free.key } } : {},
  };
}

// "Can I afford a $300 Klarna plan?": the warning, from the checking forecast.
export function bnplNewPlanReply(data: Bnpl, totalCents: number): Reply {
  const strain = warnNewPlan(data, totalCents);
  if (!strain) {
    return {
      body: "I need a checking account in your forecast to say whether a new plan fits. Connect one and I'll check.",
      actions: [BNPL_PAGE],
      refs: {},
    };
  }
  const each = formatCents(Math.ceil(totalCents / strain.installments.length));
  const first = `A ${formatCents(totalCents)} Pay in 4 plan means four payments of ${each} two weeks apart.`;
  if (strain.strained) {
    return {
      body: [
        `${first} It would take your checking down to ${formatCents(strain.lowestWith.balanceCents)} on ${dayLabel(strain.lowestWith.date)}, ${formatCents(strain.shortCents)} under the ${formatCents(LOW_BALANCE_CUSHION_CENTS)} I like to keep.`,
        `Without it, your lowest is ${formatCents(strain.lowestWithout.balanceCents)} on ${dayLabel(strain.lowestWithout.date)}. Waiting for payday, or paying in full, avoids the squeeze.`,
      ].join("\n"),
      actions: [BNPL_PAGE],
      refs: { advice: true },
    };
  }
  return {
    body: `${first} Your checking forecast stays above ${formatCents(LOW_BALANCE_CUSHION_CENTS)}: the lowest is ${formatCents(strain.lowestWith.balanceCents)} on ${dayLabel(strain.lowestWith.date)}, so it fits.`,
    actions: [BNPL_PAGE],
    refs: { advice: true },
  };
}

export const EARLY_PAYOFF_SOURCE = BNPL_EARLY_PAYOFF_SOURCE;
