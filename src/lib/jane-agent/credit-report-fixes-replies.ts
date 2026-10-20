import { dayLabel } from "@/lib/day-label";
import type { ReportFixes } from "@/lib/credit-report-fixes";
import { formatCents } from "@/lib/money";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about collections and errors on the credit report (spec step 181), from
// src/lib/credit-report-fixes.ts. Pure. The rule and deadline in each letter come from config.

export const REPORT_PAGE: MessageAction = {
  id: "open",
  label: "See your report fixes",
  kind: "link",
  href: "/loans/report",
};

export const sendButton = (label: string): MessageAction => ({
  id: "creditfix.send",
  label,
  kind: "primary",
});

// The next letter to send: a validation letter first (its window closes), then a dispute.
export function firstLetter(data: ReportFixes) {
  const open = data.fixes
    .filter((f) => !f.fixed)
    .flatMap((f) => f.letters)
    .filter((l) => !l.sent);
  return open.find((l) => l.kind === "validation") ?? open[0] ?? null;
}

export function reportFixReply(data: ReportFixes): Reply {
  if (!data.available) {
    return {
      body: "Checking your credit report for collections and errors needs a credit partner, and there isn't one for your accounts yet.",
      actions: [],
      refs: {},
    };
  }
  const items = data.fixes.filter((f) => !f.fixed);
  if (items.length === 0) {
    return {
      body: "I don't see any collections or errors on your credit report that need fixing. I check it again every month.",
      actions: [REPORT_PAGE],
      refs: {},
    };
  }
  const lines = [
    `I found ${items.length} ${items.length === 1 ? "thing" : "things"} on your credit report that may need fixing.`,
    ...items.map(
      (f) =>
        `- ${f.item.creditor}${f.item.amountCents ? `, ${formatCents(f.item.amountCents)}` : ""}: ${f.item.detail}`,
    ),
  ];
  const next = firstLetter(data);
  if (next) {
    const window = next.windowEndsOn
      ? ` The last day to ask for validation is ${dayLabel(next.windowEndsOn, { year: true })}.`
      : "";
    lines.push(
      `${next.label} is where I'd start.${window} I've written the letter; nothing is sent until you tap.`,
    );
  } else {
    lines.push("Every letter for these is sent, and I'm tracking the answers on your deadlines.");
  }
  return {
    body: lines.join("\n"),
    actions: next ? [sendButton(next.label), REPORT_PAGE] : [REPORT_PAGE],
    refs: next ? { advice: true, creditFix: { id: next.id } } : { advice: true },
  };
}
