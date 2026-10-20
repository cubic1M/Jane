import { CREDIT_GOAL_LABELS } from "@/config/credit-goals";
import { dayLabel } from "@/lib/day-label";
import type { CreditGoals, GoalDraft, GoalView } from "@/lib/credit-goals";
import { formatCents } from "@/lib/money";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about a credit score for a goal (spec step 227), from src/lib/credit-goals.ts.
// Pure. The scores are the stand-in simulator's estimates, always labelled so.

export const GOAL_PAGE: MessageAction = {
  id: "open",
  label: "See your credit plan",
  kind: "link",
  href: "/loans/goal",
};

export const ESTIMATE_NOTE =
  "These scores are estimates from the stand-in score's simulator, and nothing changes until you act.";

export const startButton = (): MessageAction => ({
  id: "creditgoal.start",
  label: "Start this plan",
  kind: "primary",
});
export const doneButton = (): MessageAction => ({
  id: "creditgoal.done",
  label: "I've done this month's list",
  kind: "primary",
});

const monthLine = (m: GoalView["plan"]["months"][number]) =>
  `- ${m.month}: ${m.payCents > 0 ? `pay ${formatCents(m.payCents)}, ` : ""}about ${m.projectedScore}`;

export function planLines(g: GoalView): string[] {
  const p = g.plan;
  const lines = [
    p.reaches
      ? `You can reach a ${g.targetScore} by ${dayLabel(g.targetDate, { year: true })}: the plan takes your score from ${g.scoreNow} to about ${p.endScore} in ${g.months} ${g.months === 1 ? "month" : "months"}.`
      : `A ${g.targetScore} by ${dayLabel(g.targetDate, { year: true })} isn't reachable from ${g.scoreNow} on the simulator: the best it shows is about ${p.best}, even with every card paid down.`,
    ...p.months.slice(0, 6).map(monthLine),
  ];
  if (p.months.length > 6) lines.push(`- and ${p.months.length - 6} more months on the page`);
  lines.push(ESTIMATE_NOTE);
  return lines;
}

export function creditGoalReply(
  data: CreditGoals,
  draft: (GoalDraft & { view: GoalView | null }) | null,
  asked: { score: number | null },
): Reply {
  if (!data.available) {
    return {
      body: "Planning a credit score needs a credit partner, and there isn't one for your accounts yet.",
      actions: [],
      refs: {},
    };
  }
  if (draft) {
    if (!draft.view) {
      return {
        body: "I haven't pulled your score yet, so there's no plan to build. I'll check it with a soft pull, which never affects it.",
        actions: [GOAL_PAGE],
        refs: {},
      };
    }
    return {
      body: planLines(draft.view).join("\n"),
      actions: draft.view.plan.months.length > 0 ? [startButton(), GOAL_PAGE] : [GOAL_PAGE],
      refs: {
        advice: true,
        creditGoalDraft: {
          kind: draft.kind,
          targetScore: draft.targetScore,
          targetDate: draft.targetDate,
        },
      },
    };
  }
  const g = data.goals[0];
  if (!g) {
    return {
      body: `Tell me the score and when you need it, like "I need a ${asked.score ?? 740} credit score for a mortgage in 6 months", and I'll plan it from your own numbers.`,
      actions: [GOAL_PAGE],
      refs: {},
    };
  }
  const todo = g.thisMonth.filter((i) => !i.done);
  return {
    body: [
      `${g.title}: you're at ${data.scoreNow}.`,
      ...(todo.length
        ? [`This month (${g.currentMonth}):`, ...todo.map((i) => `- ${i.text}`)]
        : ["This month's list is done. Nicely done."]),
      ESTIMATE_NOTE,
    ].join("\n"),
    actions: todo.length ? [doneButton(), GOAL_PAGE] : [GOAL_PAGE],
    refs: todo.length ? { advice: true, creditGoalId: g.id ?? undefined } : { advice: true },
  };
}

export const kindLabel = (k: keyof typeof CREDIT_GOAL_LABELS) => CREDIT_GOAL_LABELS[k];
