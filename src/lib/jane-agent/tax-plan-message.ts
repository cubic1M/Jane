import type { PlanMoveView, TaxPlanView } from "@/lib/tax-plan";
import { shortDate } from "./sources/source";
import type { MessageAction, MessageRefs } from "./types";

// The year-round tax plan in the chat (spec step 167): a move that's open now, with its
// deadline and what Jane prepared (at the levels that let her act, already on the
// deadlines), and the answer to "my tax plan".

export const PLAN_HREF = "/taxes#plan";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

const refsOf = (m: PlanMoveView): MessageRefs => ({
  taxPlanMove: m.id,
  ...(m.advice ? { advice: true as const } : {}),
});

export function planMoveMessage(m: PlanMoveView): Message {
  if (m.handled === "added") {
    return {
      body: `Tax move: ${m.title}, by ${shortDate(m.deadline)}. ${m.detail} I've put it on your deadlines.`,
      refs: refsOf(m),
      actions: [{ id: "open", label: "See your tax plan", kind: "link", href: PLAN_HREF }],
    };
  }
  return {
    body: `Tax move: ${m.title}, by ${shortDate(m.deadline)}. ${m.detail} Want it on your deadlines?`,
    refs: refsOf(m),
    actions: [
      { id: "tax.plan_add", label: "Add to my deadlines", kind: "primary" },
      { id: "tax.plan_no", label: "Not for me", kind: "secondary" },
      { id: "open", label: "See your tax plan", kind: "link", href: PLAN_HREF },
    ],
  };
}

const status = (m: PlanMoveView, today: string) =>
  m.handled === "added"
    ? "on your deadlines"
    : m.handled === "no"
      ? "not for you"
      : m.opensOn > today
        ? `I'll bring it up ${shortDate(m.opensOn)}`
        : "open now";

export function planReply(plan: TaxPlanView, today: string): Message {
  if (plan.moves.length === 0) {
    return {
      body: `There's nothing left on your ${plan.year} tax plan: every move's deadline has passed or doesn't apply to you.`,
      refs: {},
      actions: [{ id: "open", label: "See your taxes", kind: "link", href: PLAN_HREF }],
    };
  }
  const lines = plan.moves.map(
    (m) => `- By ${shortDate(m.deadline)}: ${m.title} (${status(m, today)})`,
  );
  return {
    body: `Your ${plan.year} tax plan, by deadline:\n${lines.join("\n")}`,
    refs: plan.moves.some((m) => m.advice) ? { advice: true } : {},
    actions: [{ id: "open", label: "See your tax plan", kind: "link", href: PLAN_HREF }],
  };
}
