import { formatCents } from "@/lib/money";
import type { CloseView } from "@/lib/month-close";
import { categoryWords } from "@/planning/month-close";
import { monthName } from "@/planning/monthly-report";
import type { Reply } from "./replies";

// The monthly close in the chat (spec step 244).

export function closedBody(view: CloseView): string {
  const f = view.figures;
  const top = f.topCategories
    .slice(0, 3)
    .map((c) => `${categoryWords(c.category)} ${formatCents(c.cents)}`)
    .join(", ");
  return [
    `${monthName(view.month)} is closed: ${formatCents(f.incomeCents)} came in and ${formatCents(f.spendingCents)} went out${top ? ` (most on ${top})` : ""}.`,
    f.netWorthCents !== null ? `Net worth at the close: ${formatCents(f.netWorthCents)}.` : null,
    f.plan?.did
      ? `Against the plan: saved ${formatCents(f.plan.did.saving)} of ${formatCents(f.plan.planned.saving)}, extra debt payments ${formatCents(f.plan.did.debt)} of ${formatCents(f.plan.planned.debt)}.`
      : null,
    f.worked && f.worked.confirmed + f.worked.notShown > 0
      ? `${f.worked.confirmed} saving${f.worked.confirmed === 1 ? "" : "s"} showed up${f.worked.notShown > 0 ? `, ${f.worked.notShown} didn't` : ""}.`
      : null,
    f.booksOpen > 0
      ? `${f.booksOpen} thing${f.booksOpen === 1 ? "" : "s"} in your accounts didn't add up, so those figures are marked.`
      : "Your books added up.",
    view.correctedAt ? "Updated after your correction." : null,
  ]
    .filter(Boolean)
    .join(" ");
}

// The close, as a line of the month's report message: the report has the figures, so the chat
// says the month is closed and whether the books added up, once (docs/feature-audit.md).
export function closedNote(view: CloseView): string {
  return [
    `${monthName(view.month)} is closed.`,
    view.figures.booksOpen > 0
      ? `${view.figures.booksOpen} thing${view.figures.booksOpen === 1 ? "" : "s"} in your accounts didn't add up, so those figures are marked.`
      : "Your books added up.",
  ].join(" ");
}

export function waitingBody(view: CloseView): string {
  const lines = view.uncertain.map(
    (t) => `• ${t.description} on ${t.date}: ${formatCents(t.amountCents)}`,
  );
  return [
    `Closing ${monthName(view.month)}: I wasn't sure what ${view.uncertain.length === 1 ? "this charge was" : `these ${view.uncertain.length} charges were`}. Are they right as they are?`,
    ...lines,
  ].join("\n");
}

export function closeReply(view: CloseView | null): Reply {
  if (!view) {
    return {
      body: "I close each month on the first of the next: the books checked, anything I'm unsure of asked in one message, then the figures kept. Nothing's been closed yet.",
      actions: [{ id: "open", label: "Monthly report", kind: "link", href: "/monthly" }],
      refs: {},
    };
  }
  if (view.status === "waiting") {
    return {
      body: waitingBody(view),
      actions: [
        { id: "close.confirm", label: "Looks right", kind: "primary" },
        { id: "open", label: "Fix categories", kind: "link", href: "/transactions" },
      ],
      refs: { closeMonth: view.month },
    };
  }
  return {
    body: closedBody(view),
    actions: [{ id: "open", label: "Monthly report", kind: "link", href: "/monthly" }],
    refs: {},
  };
}
