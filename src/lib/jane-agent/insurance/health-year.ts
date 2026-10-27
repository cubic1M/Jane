import type { PrismaClient } from "@/generated/prisma/client";
import { loadHealthYear, openDisputeCards, type HealthYear } from "@/lib/insurance/health-year";
import { monthWords } from "@/lib/insurance/health-year-rules";
import { formatCents } from "@/lib/money";
import type { Reply } from "../replies";
import { dayLabel } from "@/lib/day-label";

// "How much of my deductible have I met?" (spec step 200): where the person is in their
// health plan's year: the deductible, the out-of-pocket maximum and the month at this pace,
// FSA and HSA money, the plan's network for the providers they've paid, and big bills above
// the plan's share (with a card for the team). Facts only.

const PAGE = {
  id: "open",
  label: "Your health year",
  kind: "link",
  href: "/insurance?focus=health",
} as const;

// Pure: the lines of the answer.
export function healthYearLines(year: HealthYear): string[] {
  const { plan, progress: p } = year;
  const lines = [
    `${plan.label}: you've met ${formatCents(p.deductibleMetCents)} of your ${formatCents(plan.deductibleCents)} deductible${p.deductibleLeftCents > 0 ? ` (${formatCents(p.deductibleLeftCents)} to go)` : ""}.`,
  ];
  if (plan.outOfPocketMaxCents !== null) {
    const month = monthWords(p.maxMonth);
    lines.push(
      `You've paid about ${formatCents(p.oopSoFarCents)} toward your ${formatCents(plan.outOfPocketMaxCents)} out-of-pocket maximum. ${
        p.maxMonth === "reached"
          ? "You've reached it, so the plan pays covered care in full for the rest of the year."
          : month
            ? `At this pace you'd reach it in ${month}.`
            : "At this pace you won't reach it this year."
      }`,
    );
  }
  if (year.fsa) {
    lines.push(
      year.fsa.leftCents > 0
        ? `${formatCents(year.fsa.leftCents)} is left in your FSA and it's lost after ${dayLabel(year.fsa.deadline)} (${year.fsa.daysLeft} days), unless your employer allows a carryover.`
        : "You've used all of your FSA this year.",
    );
  }
  if (year.hsa) {
    lines.push(
      `Your ${year.hsa.name} holds ${formatCents(year.hsa.balanceCents)}; it's yours to keep, with no deadline.`,
    );
  }
  const out = year.bills.filter((b) => b.network === "out");
  if (out.length > 0) {
    lines.push(
      `${out.map((b) => b.provider).join(" and ")} ${out.length === 1 ? "is" : "are"} out of your plan's network, so the plan pays less there.`,
    );
  }
  for (const d of year.disputes) {
    lines.push(
      `${d.bill.provider} billed ${formatCents(d.paidCents)} on ${dayLabel(d.bill.date)}, but your plan's share looks like about ${formatCents(d.shouldPayCents)}. I've opened a card so the team can dispute the ${formatCents(d.overCents)} difference.`,
    );
  }
  if (year.sample) lines.push("This is the demo bank's sample plan.");
  return lines;
}

export async function healthYearAnswer(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const year = await loadHealthYear(userId, { client, now });
  if (!year) {
    return {
      body: "I don't have your health plan's deductible and out-of-pocket maximum yet. Add your health plan on your insurance page and I'll track the year for you.",
      actions: [{ id: "open", label: "Your insurance", kind: "link", href: "/insurance" }],
      refs: {},
    };
  }
  await openDisputeCards(userId, { client, now });
  return { body: healthYearLines(year).join("\n"), actions: [PAGE], refs: {} };
}
