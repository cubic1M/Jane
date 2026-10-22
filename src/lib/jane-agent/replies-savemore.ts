import { formatCents } from "@/lib/money";
import type { GoalView } from "@/lib/goals";
import type { Reply } from "./replies";

// "What if I save $200 more a month": the yearly total, and how soon it would cover the goal
// that still needs the most. Only their own figures; nothing changes.
export function saveMoreReply(monthlyCents: number, goals: GoalView[]): Reply {
  const lines = [
    `Saving ${formatCents(monthlyCents)} more a month is ${formatCents(monthlyCents * 12)} a year.`,
  ];
  const open = goals
    .flatMap((g) =>
      "leftCents" in g.progress && g.progress.leftCents > 0
        ? [{ name: g.name, left: g.progress.leftCents }]
        : [],
    )
    .sort((a, b) => b.left - a.left)[0];
  if (open) {
    const months = Math.ceil(open.left / monthlyCents);
    lines.push(
      `Put towards your ${open.name} goal, which still needs ${formatCents(open.left)}, that alone would cover it in about ${months} ${months === 1 ? "month" : "months"}.`,
    );
  }
  return {
    body: lines.join("\n"),
    actions: [
      goals.length > 0
        ? { id: "open", label: "See goals", kind: "link", href: "/goals" }
        : { id: "goal.start", label: "Start a goal", kind: "primary" },
    ],
    refs: {},
  };
}
