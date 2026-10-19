import { formatCents } from "@/lib/money";
import type { PaycheckPlanView, PlanMove } from "@/lib/money-movement/paycheck";
import type { Reply } from "./replies";
import { dateAndDays } from "./sources/source";
import type { MessageAction } from "./types";

// A paycheck's plan in the chat (spec step 144): what Jane moved by herself, what she'd
// like to move, and that the stand-in moves no real money.

const and = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
export const moveWords = (m: Pick<PlanMove, "cents" | "label" | "purpose">) =>
  m.purpose === "debt"
    ? `${formatCents(m.cents)} ${m.label}`
    : `${formatCents(m.cents)} to ${m.label}`;

export const STAND_IN_NOTE = "These are sample transfers: no real money moves.";

// With no plan yet, the next paycheck (the same one as "when is payday") says when there will be.
export type NextPaycheck = { date: string; cents: number; from: string; asOf: string };

export function paycheckReply(
  plan: PaycheckPlanView | null,
  simulated = true,
  next: NextPaycheck | null = null,
): Reply {
  if (!plan || plan.moves.length === 0) {
    return {
      body: plan
        ? `Your ${formatCents(plan.paycheckCents)} paycheck stays in checking: nothing needed moving.`
        : next
          ? `I split each paycheck when it lands. Your next one is ${dateAndDays(next.date, next.asOf)}: about ${formatCents(next.cents)} from ${next.from}. I'll show you the plan then.`
          : "I haven't seen a paycheck lately to split.",
      actions: [],
      refs: {},
    };
  }
  const auto = plan.moves.filter((m) => m.status === "auto");
  const asked = plan.moves.filter((m) => m.status === "asked");
  const moved = plan.moves.filter((m) => m.status === "moved");
  const lines = [`Your ${formatCents(plan.paycheckCents)} paycheck came in.`];
  if (auto.length > 0) {
    lines.push(
      `I'm moving ${and(auto.map(moveWords))} by myself (autopilot). You can undo it until it goes through tomorrow.`,
    );
  }
  if (moved.length > 0) lines.push(`Moving ${and(moved.map(moveWords))}, as you said.`);
  const open = plan.status === "proposed" || plan.status === "partial";
  if (asked.length > 0 && open) lines.push(`Want me to move ${and(asked.map(moveWords))} too?`);
  if (simulated) lines.push(STAND_IN_NOTE);
  const actions: MessageAction[] = [
    ...(asked.length > 0 && open
      ? [
          { id: "paycheck.move" as const, label: "Move them", kind: "primary" as const },
          { id: "paycheck.skip" as const, label: "Not this time", kind: "secondary" as const },
        ]
      : []),
    ...(auto.length > 0
      ? [{ id: "paycheck.undo" as const, label: "Undo", kind: "secondary" as const }]
      : []),
    { id: "open", label: "See transfers", kind: "link", href: "/transfers" },
  ];
  return { body: lines.join(" "), actions, refs: { paycheckPlanId: plan.id } };
}
