import type { TaxFound } from "@/planning/tax-scan";
import type { DueEstimate, TaxCalendarView, YearEndView } from "@/lib/tax-calendar";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import type { MessageAction, MessageRefs } from "./types";

// The tax year that runs itself, in the chat (spec step 223): an estimated payment that
// needs the person's tap (over the cap, or they asked Jane to ask first), December's
// year-end moves in one message, and the answer to "my tax calendar".

export const CALENDAR_HREF = "/taxes/calendar";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function estimateDueMessage(d: DueEstimate, year: number): Message {
  const why =
    d.needsTap === "level"
      ? "You asked me to ask first, so"
      : d.needsTap === "monthly_cap"
        ? "That would take me over what I may pay in a month on my own, so"
        : "That's more than I pay on my own for taxes, so";
  return {
    body: `Your estimated tax payment of ${formatCents(d.cents)} is due ${dayLabel(d.dueOn, { year: true })}. ${why} it's your tap. Pay it now?`,
    refs: { taxYear: year, estimateDue: d.dueOn },
    actions: [
      { id: "tax.estimate_pay", label: `Pay ${formatCents(d.cents)}`, kind: "primary" },
      { id: "open", label: "See my tax calendar", kind: "link", href: CALENDAR_HREF },
    ],
  };
}

export function yearEndMessage(y: YearEndView, acts: boolean): Message {
  const list = y.lines.map((l) => `• ${l}`).join("\n");
  return {
    body: `Here are the tax moves still open before December 31.\n${list}\n${
      acts || y.open === 0
        ? "The ones with a deadline are already on your deadlines."
        : "Want them on your deadlines?"
    }`,
    refs: { advice: true, taxYear: y.year },
    actions: [
      ...(acts || y.open === 0
        ? []
        : [
            {
              id: "tax.yearend_plan" as const,
              label: "Put them on my deadlines",
              kind: "primary" as const,
            },
          ]),
      { id: "open", label: "See my tax calendar", kind: "link", href: CALENDAR_HREF },
    ],
  };
}

const MARK = {
  done: "done",
  tap: "needs you",
  waiting: "coming",
  nothing: "nothing to do",
} as const;

export function calendarReply(v: TaxCalendarView, found: readonly TaxFound[] = []): Message {
  const lines = v.items.map((i) => `${i.title} (${MARK[i.status]}): ${i.detail}`);
  // Spec step 273: what every tax detector found for them, in this month.
  for (const f of found.filter((x) => x.month === v.month))
    lines.push(`${f.headline} (${f.percent}% sure)`);
  return {
    body: `Here is your tax calendar for ${v.label}.\n${lines.map((l) => `• ${l}`).join("\n")}\n${
      v.acts
        ? "I do the safe parts myself, and ask for a tap on anything that moves money above your cap."
        : "You asked me to ask first, so I check each one with you."
    }`,
    refs: {},
    actions: [{ id: "open", label: "See the whole year", kind: "link", href: CALENDAR_HREF }],
  };
}
