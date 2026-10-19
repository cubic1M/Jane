import type { GoalView } from "@/lib/goals";
import { formatCents } from "@/lib/money";
import { goalsBlock } from "./block-data";
import type { Reply } from "./replies";

// Spec step 94: "how are my goals doing?": how many are on track first, then any that need
// something, with each goal's progress as bars (the same numbers as Goals). Pure.

const goalsLink = {
  id: "open" as const,
  label: "See goals",
  kind: "link" as const,
  href: "/goals",
};

export function goalsReply(goals: readonly GoalView[]): Reply {
  if (goals.length === 0) {
    return {
      body: 'You don\'t have any goals yet. Ask me "can I afford $900 for a trip in March" and I can start one for you.',
      actions: [goalsLink],
      refs: {},
    };
  }
  const fine = goals.filter((g) => g.progress.status !== "date_passed");
  const passed = goals.filter((g) => g.progress.status === "date_passed");
  const reached = goals.filter((g) => g.progress.status === "reached");
  const first =
    reached.length === goals.length
      ? `You've reached ${goals.length === 1 ? "your goal" : `all ${goals.length} of your goals`}.`
      : fine.length === goals.length
        ? `${goals.length === 1 ? "Your goal is" : `All ${goals.length} of your goals are`} on track${reached.length ? `, ${reached.length} already reached` : ""}.`
        : `${fine.length} of your ${goals.length} goals ${fine.length === 1 ? "is" : "are"} on track.`;
  const lines = [first];
  for (const g of goals) {
    if (g.progress.status === "on_the_way") {
      lines.push(`${g.name}: ${formatCents(g.progress.monthlyCents)} a month to reach it on time.`);
    }
  }
  for (const g of passed) {
    if (g.progress.status === "date_passed") {
      lines.push(
        `${g.name} reached its date with ${formatCents(g.progress.leftCents)} still to go: you can pick a new date on Goals.`,
      );
    }
  }
  const block = goalsBlock(goals);
  return { body: lines.join("\n"), actions: [goalsLink], refs: block ? { block } : {} };
}
