import type { CreditMonthly, MonthlyItem } from "@/lib/credit-monthly";
import type { Reply } from "./replies";
import type { MessageAction, MessageRefs } from "./types";

// The monthly credit check-up in the chat (spec step 251), from src/lib/credit-monthly.ts.
// Pure. One message: what Jane did on its own, and each item that waits for the person with a
// button to the page where they act (applying, cancelling and sending stay there, on a tap).

export const MONTHLY_PAGE: MessageAction = {
  id: "open",
  label: "See the check-up",
  kind: "link",
  href: "/loans/review",
};

const MARK = { done: "Done", tap: "Needs you", ok: "Fine" } as const;

export const monthlyLine = (i: MonthlyItem) => `- ${i.title} (${MARK[i.status]}): ${i.text}`;

export function monthlyMessage(d: CreditMonthly): {
  body: string;
  actions: MessageAction[];
  refs: MessageRefs;
} {
  const waiting = d.items.filter((i) => i.status === "tap");
  const done = d.items.filter((i) => i.status === "done").length;
  const head =
    waiting.length === 0
      ? "This month's credit check-up: nothing is waiting on you."
      : `This month's credit check-up: ${waiting.length} ${waiting.length === 1 ? "thing needs" : "things need"} you${done > 0 ? `, and I handled ${done}` : ""}.`;
  const seen = new Set<string>();
  const actions: MessageAction[] = [];
  for (const i of waiting) {
    if (!i.link || seen.has(i.link.href)) continue;
    seen.add(i.link.href);
    actions.push({ id: "open", label: i.link.label, kind: "link", href: i.link.href });
  }
  return {
    body: [head, ...d.items.map(monthlyLine)].join("\n"),
    actions: [...actions, MONTHLY_PAGE],
    refs: d.advice ? { advice: true } : {},
  };
}

export function creditMonthlyReply(d: CreditMonthly): Reply {
  if (!d.available) {
    return {
      body: "There's nothing on credit to check this month: no loan or card balance, no rent and no costly borrowing.",
      actions: [],
      refs: {},
    };
  }
  const msg = monthlyMessage(d);
  const level =
    d.level === "all"
      ? "At Handle everything I also send the next lower-rate request to a card myself, once a month."
      : "I soft-check rates and what you could borrow myself; everything else is your tap.";
  return {
    body: [
      msg.body,
      level,
      "Nothing that runs a hard credit check or opens an account happens without your tap.",
    ].join("\n"),
    actions: msg.actions,
    refs: msg.refs,
  };
}
