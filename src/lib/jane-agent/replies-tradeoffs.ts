import type { TradeoffView } from "@/lib/goal-tradeoffs";
import { type GoalDate } from "@/planning/goal-tradeoffs";
import type { Reply } from "./replies";
import { monthLabel } from "@/lib/day-label";

// Goals that trade off openly in the chat (spec step 241): each goal's date under each order,
// Jane's suggested order with the reason, and one tap to use it. Nothing re-plans without it.

const when = (d: GoalDate) => {
  if (d.month === null) return `${d.name}: not within ten years`;
  const late =
    d.lateMonths !== null && d.lateMonths > 0
      ? `, ${d.lateMonths} month${d.lateMonths === 1 ? "" : "s"} late`
      : " (on time)";
  return `${d.name}: ${monthLabel(d.month, { long: true })}${late}`;
};

export function tradeoffsReply(view: TradeoffView | null): Reply {
  if (!view) {
    return {
      body: "Once your accounts are linked and you have goals, I can show how they trade off.",
      actions: [],
      refs: {},
    };
  }
  if (!view.competing || !view.suggested) {
    return {
      body: view.current
        ? `Your goals don't compete: the plan has room for each on time. ${view.current.dates.map(when).join("; ")}.`
        : "You need at least two goals for them to trade off. Add them on Goals.",
      actions: [{ id: "open", label: "See goals", kind: "link", href: "/goals" }],
      refs: {},
    };
  }
  const options = view.options
    .slice(0, 3)
    .map(
      (o) =>
        `${o.order.length > 0 ? `${o.dates[0].name} first` : ""}: ${o.dates.map(when).join("; ")}`,
    );
  const picked =
    view.chosen && view.chosen.join() === view.suggested.order.join()
      ? " That's the order you picked."
      : "";
  const showsPick = !picked;
  return {
    body: [
      "Your goals need more each month than the plan has room for, so one waits for another.",
      ...options.map((o) => `• ${o}`),
      `${view.reason}${picked}`,
    ].join("\n"),
    actions: [
      ...(showsPick
        ? [
            {
              id: "tradeoffs.pick" as const,
              label: `${view.suggested.dates[0].name} first`,
              kind: "primary" as const,
            },
            {
              id: "tradeoffs.keep" as const,
              label: "Keep it as it is",
              kind: "secondary" as const,
            },
          ]
        : []),
      { id: "open", label: "Compare on Goals", kind: "link", href: "/goals#tradeoffs" },
    ],
    refs: showsPick ? { goalOrder: view.suggested.order.join(",") } : {},
  };
}
