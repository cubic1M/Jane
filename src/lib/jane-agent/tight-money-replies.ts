import { HARDSHIP_SOURCE } from "@/config/tight-money";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import type { TightMoney } from "@/lib/tight-money";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers when money is tight (spec step 177), from src/lib/tight-money.ts. Pure.
// Essentials (housing, utilities, insurance) always come first, and every request waits
// for the person's tap.

export const TIGHT_PAGE: MessageAction = {
  id: "open",
  label: "See the plan",
  kind: "link",
  href: "/loans/tight",
};

export const sendButton = (label: string): MessageAction => ({
  id: "tight.send",
  label,
  kind: "primary",
});

export const billLines = (data: TightMoney, limit = 5) =>
  data.billsFirst
    .slice(0, limit)
    .map(
      (b) =>
        `- ${b.payee}, ${formatCents(b.amountCents)} on ${dayLabel(b.date)}${b.essential ? ` (${b.essential})` : ""}`,
    );

export function shortLine(data: TightMoney): string | null {
  const s = data.shortfall;
  if (!s) return null;
  return `Your checking is forecast to be ${s.balanceCents < 0 ? `${formatCents(-s.balanceCents)} overdrawn` : `down to ${formatCents(s.balanceCents)}`} on ${dayLabel(s.date)}, ${formatCents(s.shortCents)} under the cushion I like to keep.`;
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

export const HARDSHIP_LINK = HARDSHIP_SOURCE;
