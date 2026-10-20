import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";
import { things, type MessageSource } from "./source";

// The week's plan (spec step 82), once a week when there's something on it: "N things,
// worth up to $X a year if you say yes to all" (the same words as /plan), with "Approve all safe ones" (the same no-risk items a one-tap
// link covers: never calls, cancellations, moving money or insurance) and Review.

export const planSource: MessageSource = {
  key: "plan",
  gather(snapshot) {
    const { items, annualSavingsCents, safeItems } = snapshot.plan;
    if (items === 0) return [];
    const headline =
      annualSavingsCents > 0
        ? `Your plan for this week is ready: ${things(items)}, worth up to ${formatCents(annualSavingsCents)} a year if you say yes to all.`
        : `Your plan for this week is ready: ${things(items)}.`;
    const safe =
      safeItems === 0
        ? "Each one needs a look from you."
        : safeItems === items
          ? `${items === 1 ? "It's" : "All of them are"} safe for me to just do.`
          : `${safeItems} of them ${safeItems === 1 ? "is" : "are"} safe for me to just do; the rest need a look from you.`;
    const actions: MessageAction[] = [
      ...(safeItems > 0
        ? [
            {
              id: "plan.approve_safe" as const,
              label: "Approve all safe ones",
              kind: "primary" as const,
            },
          ]
        : []),
      { id: "open", label: "Review", kind: "link", href: "/plan" },
    ];
    return [
      {
        kind: "decision",
        body: `${headline} ${safe}`,
        refs: { weekStart: snapshot.weekStart },
        actions,
        dedupeKey: snapshot.weekStart,
        priority: MESSAGE_PRIORITY.plan,
      },
    ];
  },
};
