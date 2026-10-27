import type { PortfolioReview } from "./portfolio-review";
import { classWords } from "./portfolio-review";
import { monthLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";

// The monthly portfolio note (spec step 137): how the investments stand at the start of the
// month, what changed, what went in, what they cost, and at most one thing to decide. Pure.
// Facts about the past only: never a word about where markets are going.

export type NoteInput = {
  // YYYY-MM the note is for (the month just started).
  month: string;
  totalCents: number;
  // The total at the end of the month before last and last month, from daily snapshots.
  previousCents: number | null;
  // Paid in last month (contributions and deposits).
  contributedCents: number;
  feesYearlyCents: number;
  review: Pick<PortfolioReview, "offTarget" | "riskLabel" | "mix"> | null;
  ordersReady: number;
};

export function portfolioNote(input: NoteInput): { body: string; decision: "rebalance" | null } {
  const parts = [
    `Your investments start ${monthLabel(input.month, { long: true, year: false })} at ${formatCents(Math.abs(input.totalCents))}.`,
  ];
  if (input.previousCents !== null) {
    const change = input.totalCents - input.previousCents;
    parts.push(
      change === 0
        ? "That's the same as a month ago."
        : `That's ${change > 0 ? "up" : "down"} ${formatCents(Math.abs(change))} from a month ago, counting what went in.`,
    );
  }
  if (input.contributedCents > 0)
    parts.push(`${formatCents(Math.abs(input.contributedCents))} went in last month.`);
  if (input.feesYearlyCents > 0)
    parts.push(`Fees run about ${formatCents(Math.abs(input.feesYearlyCents))} a year.`);
  let decision: "rebalance" | null = null;
  if (input.review) {
    if (input.review.offTarget) {
      const worst = [...input.review.mix].sort(
        (a, b) => Math.abs(b.share - b.targetShare) - Math.abs(a.share - a.targetShare),
      )[0];
      parts.push(
        `Your mix has drifted from your ${input.review.riskLabel.toLowerCase()} target: ${Math.round(worst.share * 100)}% ${classWords(worst.label)} against ${Math.round(worst.targetShare * 100)}%.`,
      );
      if (input.ordersReady > 0) {
        parts.push("I've got the orders ready to bring it back.");
        decision = "rebalance";
      }
    } else {
      parts.push(`Your mix is on your ${input.review.riskLabel.toLowerCase()} target.`);
    }
  }
  return { body: parts.join(" "), decision };
}
