import type { DraftReturnView } from "@/lib/draft-return";
import { formatCents } from "@/lib/money";
import { draftCents, type DraftFinding } from "@/planning/draft-return";
import type { MessageAction, MessageRefs } from "./types";

// The return, checked before you file, in the chat (spec step 272): a draft Jane read and wants
// confirmed, each thing its check found as a card with its dollars, and the answer to "check my
// return before I file". Jane never files.

export const DRAFT_HREF = "/taxes/draft";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

const amount = (f: DraftFinding) =>
  f.effect === "saves"
    ? `about ${formatCents(f.dollarsCents)} back`
    : `about ${formatCents(f.dollarsCents)} more tax`;

export function draftReadingMessage(d: DraftReturnView): Message {
  const read = d.fields.taxYear
    ? `your ${d.fields.taxYear} draft return: wages ${formatCents(draftCents(d.fields, "wages"))}, total tax ${formatCents(draftCents(d.fields, "totalTax"))}, ${draftCents(d.fields, "refund") >= 0 ? `a refund of ${formatCents(draftCents(d.fields, "refund"))}` : `${formatCents(-draftCents(d.fields, "refund"))} to pay`}`
    : `${d.fileName}, but not its tax year`;
  return {
    body: `I read ${read}. Is that what it says? Once you confirm, I check every line against your forms and accounts before you file.`,
    refs: { draftReturn: d.id },
    actions: [
      { id: "tax.draft_confirm", label: "Yes, check it", kind: "primary" },
      { id: "open", label: "Fix what you read", kind: "link", href: DRAFT_HREF },
      { id: "tax.draft_dismiss", label: "Not a draft return", kind: "secondary" },
    ],
  };
}

export function draftFindingMessage(d: DraftReturnView, f: DraftFinding): Message {
  return {
    body: `${f.title} (${f.line}): ${amount(f)}. ${f.why} Fix it in your software, or send it to whoever prepares your return, before you file. I don't file it.`,
    refs: { draftReturn: d.id, taxYear: d.year ?? undefined },
    actions: [
      { id: "open", label: "See every line", kind: "link", href: DRAFT_HREF },
      { id: "open", label: "Share with my accountant", kind: "link", href: "/taxes/accountant" },
    ],
  };
}

export function draftReply(drafts: readonly DraftReturnView[]): Message {
  const waiting = drafts.find((d) => d.status === "waiting");
  if (waiting) return draftReadingMessage(waiting);
  const checked = drafts.filter((d) => d.status === "confirmed").at(-1);
  if (!checked)
    return {
      body: "Upload the draft from your tax software or accountant to Documents as \"Draft tax return\" before you file. I'll read it, you confirm what I read, and I check every line against your forms and accounts: income missing, deductions or credits left out, figures that don't match. I never file it.",
      refs: {},
      actions: [{ id: "open", label: "Upload my draft", kind: "link", href: "/documents" }],
    };
  if (checked.findings.length === 0)
    return {
      body: `I checked your ${checked.year} draft against your forms and accounts and found nothing to fix. Filing is yours.`,
      refs: { draftReturn: checked.id },
      actions: [{ id: "open", label: "See every line", kind: "link", href: DRAFT_HREF }],
    };
  return {
    body: `Here is what I found in your ${checked.year} draft.\n${checked.findings
      .map((f) => `• ${f.title} (${f.line}): ${amount(f)}.`)
      .join("\n")}\nFix them before you file; I don't file it.`,
    refs: { draftReturn: checked.id, taxYear: checked.year ?? undefined },
    actions: [{ id: "open", label: "See every line", kind: "link", href: DRAFT_HREF }],
  };
}
