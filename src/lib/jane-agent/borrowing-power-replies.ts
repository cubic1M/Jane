import { BORROW_LABELS } from "@/config/borrowing-power";
import { formatRate } from "@/insights/loans";
import type { BorrowingPower, Figure } from "@/lib/borrowing-power";
import { homeVsBorrow, mortgageOf, type HomeMeasure } from "@/planning/home-vs-borrow";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answer to "what could I borrow, and at what rate?" (spec step 250), from
// src/lib/borrowing-power.ts. Pure. Every figure says when it was checked; the quotes are soft
// checks from the lender stand-in, not offers, and nothing is applied for.

export const BORROW_PAGE: MessageAction = {
  id: "open",
  label: "What you could borrow",
  kind: "link",
  href: "/loans/borrow",
};

const years = (months: number) => `${Math.round(months / 12)} years`;

export function figureLine(f: Figure): string {
  const label = BORROW_LABELS[f.product];
  if (!f.available) return `- ${label}: not yet. ${f.why ?? ""}`.trim();
  if (f.product === "card") {
    return `- ${label}: about ${formatRate(f.aprBps!)} after any intro offer, with a limit around ${formatCents(f.limitCents)} (a guess from your income; the issuer sets it).`;
  }
  return `- ${label}: up to about ${formatCents(f.amountCents)} at about ${formatRate(f.aprBps!)} over ${years(f.termMonths)} (${f.lender}), ${formatCents(f.paymentCents)} a month${f.feeCents > 0 ? `, ${formatCents(f.feeCents)} in fees` : ""}.`;
}

export function scoreLine(d: BorrowingPower): string {
  return d.score !== null && d.scoreOn !== null
    ? `Priced by your score of ${d.score} from ${dayLabel(d.scoreOn, { year: true })}.`
    : "I haven't pulled your score yet, so these assume a middling one.";
}

// `home`: the 28/36 home size "can I afford a house?" shows, so the two sizes are said together.
export function borrowingReply(d: BorrowingPower, home: HomeMeasure | null = null): Reply {
  if (!d.available || d.checkedOn === null) {
    return {
      body: "I can't check what you could borrow yet: there's no lending partner for your accounts. When there is, I'll keep a soft-check estimate for a mortgage, a car loan, a personal loan and a card here.",
      actions: [BORROW_PAGE],
      refs: {},
    };
  }
  const lines = [
    `Here's what you could likely get, from soft checks on ${dayLabel(d.checkedOn, { year: true })} (they don't touch your score):`,
    ...d.figures.map(figureLine),
    scoreLine(d),
  ];
  const both = homeVsBorrow(home, mortgageOf(d.figures));
  if (both) lines.push(both);
  const helps = d.figures.flatMap((f) => (f.available ? f.improve.slice(0, 1) : []));
  if (helps[0]) lines.push(`What would help: ${helps[0]}`);
  lines.push(
    "These are estimates from the lender stand-in, not offers. Applying is a separate step, and only on your tap.",
  );
  // The lender and rate are the stand-in's picks, shown only in demo advice mode: labelled.
  return { body: lines.join("\n"), actions: [BORROW_PAGE], refs: { advice: true } };
}
