import { BUDGET_NEARLY_OVER_SHARE, MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { snoozeButton, type MessageSource } from "./source";

// Budgets nearly used up (spec step 83): once a budget's spending this month reaches
// BUDGET_NEARLY_OVER_SHARE of it, with what's left, "Open" and "Snooze". One gone over is
// a heads-up of its own (./heads-ups.ts). Once per budget a month.

export const budgetsSource: MessageSource = {
  key: "budgets",
  gather(snapshot) {
    return snapshot.budgetProgress.flatMap((b) => {
      if (b.budgetCents <= 0) return [];
      const over = b.spentCents > b.budgetCents;
      if (over || b.spentCents < b.budgetCents * BUDGET_NEARLY_OVER_SHARE) return [];
      const percent = Math.floor((b.spentCents / b.budgetCents) * 100);
      return [
        {
          kind: "heads_up" as const,
          body: `You've used ${percent}% of your ${b.category} budget this month: ${formatCents(b.spentCents)} of ${formatCents(b.budgetCents)}, with ${formatCents(b.budgetCents - b.spentCents)} left.`,
          refs: {},
          actions: [
            { id: "open", label: "Open", kind: "link", href: "/budgets" } as const,
            snoozeButton("Snooze"),
          ],
          dedupeKey: `near:${b.category}:${b.month}`,
          priority: MESSAGE_PRIORITY.budget_nearly_over,
        },
      ];
    });
  },
};
