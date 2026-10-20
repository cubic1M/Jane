import { BUFFER_FLOOR_MONTHS, BUFFER_TARGET_MONTHS } from "@/config/steady-pay";
import { formatCents } from "@/lib/money";
import type { SteadyView } from "@/lib/steady-pay";
import type { Reply } from "./replies";

// A steady paycheck from uneven income in the chat (spec step 240).

export function steadyReply(view: SteadyView | null): Reply {
  if (!view) {
    return {
      body: "Once your accounts are linked, I can work out a steady paycheck from uneven income.",
      actions: [],
      refs: {},
    };
  }
  if (!view.uneven) {
    return {
      body: "I don't see uneven income yet (contracting or gig deposits). If yours swings month to month, say so and I'll set up a steady paycheck from a buffer, with tax set aside from each deposit.",
      actions: [{ id: "steady.on", label: "My income is uneven", kind: "primary" }],
      refs: {},
    };
  }
  if (!view.plan || view.plan.status === "not_enough_history") {
    return {
      body: view.plan?.reason ?? "I need a savings account as the buffer to set this up.",
      actions: [],
      refs: {},
    };
  }
  const { plan } = view;
  const lines = [
    `Your steady paycheck is ${formatCents(plan.paycheckCents)} a month, from the buffer in your savings to checking. ${plan.reason}`,
    `The buffer aims for ${BUFFER_TARGET_MONTHS} months of spending (${formatCents(plan.targetCents)}) and never goes below ${BUFFER_FLOOR_MONTHS} (${formatCents(plan.floorCents)}). It has ${formatCents(view.bufferCents)}.`,
    view.setAsideRate > 0
      ? `From each deposit, ${Math.round(view.setAsideRate * 100)}% is set aside for tax and the rest goes to the buffer.`
      : null,
    view.sent
      ? `This month's ${formatCents(view.sent.amountCents)} ${view.sent.by === "autopilot" ? "went by itself (autopilot)" : "went as you said"} on ${view.sent.runOn}; you can undo it on Transfers until then.`
      : null,
  ].filter((l): l is string => Boolean(l));
  return {
    body: lines.join(" "),
    actions: [
      ...(!view.sent && plan.status === "ready"
        ? [
            { id: "steady.pay" as const, label: "Pay me now", kind: "primary" as const },
            { id: "steady.skip" as const, label: "Not this month", kind: "secondary" as const },
          ]
        : []),
      { id: "open", label: "See transfers", kind: "link", href: "/transfers" },
    ],
    refs: {},
  };
}
