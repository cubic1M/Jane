import {
  buildReview,
  reviewIntro,
  type ReviewInput,
  type ReviewItem,
} from "@/planning/yearly-review";
import type { InvestmentSnapshot } from "./snapshot";
import { planSummary } from "./rebalance-copy";
import type { ActionId, MessageAction } from "../types";

// The yearly investing review in the chat (spec step 216): one message, every item with its
// own button. The words are from src/planning/yearly-review.ts.

export const REVIEW_LINK: MessageAction = {
  id: "open",
  label: "See your investing",
  kind: "link",
  href: "/investments",
};

export const reviewBody = (input: Pick<ReviewInput, "year" | "reason">, items: ReviewItem[]) =>
  [
    reviewIntro(input),
    ...items.map(
      (i) =>
        `${i.status === "ok" ? "✓" : i.status === "done" ? "Done:" : i.status === "tap" ? "Needs your tap:" : "•"} ${i.line}`,
    ),
    "Nothing moves until you tap; anything I did by myself was within the caps you set.",
  ].join("\n");

const LABELS: Record<string, string> = {
  "retire.match": "Raise my contribution for the match",
  "retire.ira": "Put the room in my IRA",
  "oldplan.rollover": "Roll over the old 401(k)",
  "invest.rebalance": "Move to the recommended mix",
  "review.harvest": "Harvest the losses",
};

// One button per item that needs a tap, using the action each already has.
export const reviewButtons = (items: ReviewItem[]): MessageAction[] => {
  const seen = new Set<string>();
  const out: MessageAction[] = [];
  for (const i of items) {
    if (i.status !== "tap" || !i.action || seen.has(i.action)) continue;
    seen.add(i.action);
    out.push({
      id: i.action as ActionId,
      label: LABELS[i.action] ?? "Do it",
      kind: out.length === 0 ? "primary" : "secondary",
    });
  }
  return out;
};

// The review's input from what the investing snapshot already holds.
export function reviewInput(inv: InvestmentSnapshot, year: number): ReviewInput {
  const ra = inv.retirementAccounts;
  const iraRoom = ra.limits.find((l) => l.key === "ira")?.roomCents ?? 0;
  const iraTap = ra.ira && ra.iraAllowedCents > 0 && ra.roth.access?.kind !== "backdoor";
  return {
    year,
    reason: inv.review2.raise ? "raise" : "yearly",
    limits: ra.limits,
    match: ra.match ? { missedCents: ra.match.missedCents, tapAvailable: !ra.pending } : null,
    iraTap: iraTap && iraRoom > 0 ? { cents: ra.iraAllowedCents } : null,
    oldPlans: inv.oldAccounts.plans
      .filter((p) => p.status === "found" && (p.fees?.savedCents ?? 0) > 0)
      .map((p) => ({ employer: p.employer, savedCents: p.fees!.savedCents })),
    rebalance: inv.rebalance
      ? { orders: inv.rebalance.orders.length, summary: planSummary(inv.rebalance) }
      : null,
    harvest:
      inv.review2.harvest.length > 0
        ? {
            count: inv.review2.harvest.length,
            lossCents: inv.review2.harvest.reduce((s, h) => s + h.lossCents, 0),
          }
        : null,
    fees:
      inv.fees.totalYearlyCents > 0
        ? {
            yearlyCents: inv.fees.totalYearlyCents,
            savingCents: inv.fees.equivalents.reduce((s, e) => s + e.yearlySavingCents, 0),
          }
        : null,
    goals: inv.review2.goals,
    did: inv.automatic.did.map((d) => d.what),
    asked: inv.automatic.asked.map((a) => a.what.replace(/^Asked first, over [^:]+: /, "")),
  };
}

export const reviewFor = (inv: InvestmentSnapshot, year: number) => {
  const input = reviewInput(inv, year);
  const items = buildReview(input);
  return { input, items, body: reviewBody(input, items), buttons: reviewButtons(items) };
};
