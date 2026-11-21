import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import type { TightMoney } from "@/lib/tight-money";
import type { Reply } from "./replies";
import { type MessageAction, openLink } from "./types";

// Jane's answers when money is tight (spec step 177), from src/lib/tight-money.ts. Pure.
// Essentials (housing, utilities, insurance) always come first, and every request waits
// for the person's tap.

export const TIGHT_PAGE: MessageAction = openLink("See the plan", "/loans/tight");

export const sendButton = (label: string): MessageAction => ({
  id: "tight.send",
  label,
  kind: "primary",
});

const billLines = (data: TightMoney, limit = 5) =>
  data.billsFirst
    .slice(0, limit)
    .map(
      (b) =>
        `- ${b.payee}, ${formatCents(b.amountCents)} on ${dayLabel(b.date)}${b.essential ? ` (${b.essential})` : ""}`,
    );

function shortLine(data: TightMoney): string | null {
  const s = data.shortfall;
  if (!s) return null;
  return `Your checking is forecast to be ${s.balanceCents < 0 ? `${formatCents(-s.balanceCents)} overdrawn` : `down to ${formatCents(s.balanceCents)}`} on ${dayLabel(s.date)}, ${formatCents(s.shortCents)} under the cushion I like to keep.`;
}

// The tight month's plan card (./sources/tight-money.ts): the shortfall, the bills to pay first and
// the next request, ready to send. An open one is said again from today's figures (./still-true.ts).
export function tightPlanBody(data: TightMoney, next: { label: string }): string {
  return [
    shortLine(data)!,
    "Pay these first, essentials before anything else:",
    ...billLines(data, 4),
    `To ease it: ${next.label.charAt(0).toLowerCase()}${next.label.slice(1)}. I've written the request; nothing is sent until you tap.`,
  ].join("\n");
}

export function firstUnsent(data: TightMoney) {
  return data.items.find((i) => !i.sent) ?? null;
}

export function tightReply(data: TightMoney): Reply {
  if (!data.available) {
    return {
      body: "I can only prepare help for a tight month once a lender partner is connected, and there isn't one for your accounts yet.",
      actions: [],
      refs: {},
    };
  }
  if (!data.shortfall) {
    return {
      body: "Your checking forecast stays above its cushion for the next month, so there's nothing tight to plan for. If that changes, I'll prepare the options before it does.",
      actions: [TIGHT_PAGE],
      refs: {},
    };
  }
  const next = firstUnsent(data);
  const lines = [
    shortLine(data)!,
    "Pay these first, essentials before anything else:",
    ...billLines(data),
  ];
  const sent = data.items.filter((i) => i.sent).length;
  if (data.items.length > 0) {
    lines.push(
      `${data.items.length} ${data.items.length === 1 ? "request" : "requests"} could ease it${sent ? `, ${sent} already sent` : ""}. Each one waits for your tap.`,
    );
  }
  return {
    body: lines.join("\n"),
    actions: next ? [sendButton(next.label), TIGHT_PAGE] : [TIGHT_PAGE],
    refs: next ? { advice: true, tightItem: { id: next.id } } : { advice: true },
  };
}
