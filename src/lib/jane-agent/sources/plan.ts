import { yearlyAndOnce } from "@/lib/report-state";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { type MessageAction, openLink } from "../types";
import type { Snapshot } from "../snapshot";
import { things, type MessageSource } from "./source";

// The week's plan (spec step 82), once a week when there's something on it: "N things,
// worth up to $X a year if you say yes to all" (the same words as /plan), with "Approve all safe ones" (the same no-risk items a one-tap
// link covers: never calls, cancellations, moving money or insurance) and Review.

// The card's words for the plan as given: the source says them once a week, and the cards say
// them again from the plan as it is now (./still-true.ts).
export function planWords(plan: Snapshot["plan"], concierge: boolean | undefined): string {
  const { items, annualSavingsCents, onceCents = 0, safeItems } = plan;
  const headline =
    annualSavingsCents > 0
      ? `Your plan for this week is ready: ${things(items)}, worth up to ${yearlyAndOnce({ cents: annualSavingsCents, onceCents })} if you say yes to all.`
      : `Your plan for this week is ready: ${things(items)}.`;
  // A real account in the read-only beta: Jane doesn't act for it, so nothing is "safe for me to
  // just do" and there's nothing to approve; each step is the person's (debugger 11-02).
  const safe =
    concierge === false
      ? "Each one comes with Jane's steps for you to do."
      : safeItems === 0
        ? "Each one needs a look from you."
        : safeItems === items
          ? `${items === 1 ? "It's" : "All of them are"} safe for me to just do.`
          : `${safeItems} of them ${safeItems === 1 ? "is" : "are"} safe for me to just do; the rest need a look from you.`;
  return `${headline} ${safe}`;
}

export const planSource: MessageSource = {
  key: "plan",
  gather(snapshot) {
    const { items, safeItems } = snapshot.plan;
    if (items === 0) return [];
    const actsForYou = snapshot.concierge !== false;
    const actions: MessageAction[] = [
      ...(actsForYou && safeItems > 0
        ? [
            {
              id: "plan.approve_safe" as const,
              label: "Approve all safe ones",
              kind: "primary" as const,
            },
          ]
        : []),
      openLink("Review", "/plan"),
    ];
    return [
      {
        kind: "decision",
        body: planWords(snapshot.plan, snapshot.concierge),
        refs: { weekStart: snapshot.weekStart },
        actions,
        dedupeKey: snapshot.weekStart,
        priority: MESSAGE_PRIORITY.plan,
      },
    ];
  },
};
