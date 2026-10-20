import { SOURCE_WORDS, centsOf } from "@/planning/prior-return";
import type { PriorReturnView } from "@/lib/prior-return";
import type { ReturnReview } from "@/lib/prior-return/review";
import { formatCents } from "@/lib/money";
import { dayLabel } from "@/lib/day-label";
import type { MessageAction, MessageRefs } from "./types";

// Last year's return in the chat (spec step 172): a return Jane read from an upload, to
// confirm with a tap; then what the review found, with a button to prepare the amended
// return. Signing is on the page only.

export const RETURN_HREF = "/taxes/last-return";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function readingMessage(r: PriorReturnView): Message {
  const f = r.fields;
  const bits = [
    f.taxYear ? `tax year ${f.taxYear}` : null,
    f.agi ? `adjusted gross income ${formatCents(centsOf(f, "agi"))}` : null,
    f.deductionKind ? `${f.deductionKind} deduction` : null,
    f.totalTax ? `total tax ${formatCents(centsOf(f, "totalTax"))}` : null,
    f.refund
      ? `${centsOf(f, "refund") >= 0 ? "refund" : "owed"} ${formatCents(Math.abs(centsOf(f, "refund")))}`
      : null,
  ].filter(Boolean);
  const complete = Boolean(f.taxYear && f.deductionKind);
  const from = r.sources.taxYear ? SOURCE_WORDS[r.sources.taxYear] : "";
  return {
    body: complete
      ? `I read your return from ${r.fileName}: ${bits.join(", ")}${from ? ` (${from})` : ""}. Is that right? I won't use it until you confirm, and you can fix any field first.`
      : `I couldn't read all of ${r.fileName}. Fill in the rest and confirm, and I'll check it against your accounts.`,
    refs: { priorReturn: r.id },
    actions: [
      ...(complete
        ? [
            {
              id: "tax.prior_confirm",
              label: "Yes, that's right",
              kind: "primary",
            } as MessageAction,
          ]
        : []),
      {
        id: "open",
        label: complete ? "Fix a field" : "Fill it in",
        kind: "link",
        href: RETURN_HREF,
      },
      { id: "tax.prior_no", label: "Not my return", kind: "secondary" },
    ],
  };
}

export function reviewMessage(r: ReturnReview): Message {
  const list = r.findings.map((f) => `• ${f.title}: about ${formatCents(f.savesCents)}`).join("\n");
  const body = `Looking at your ${r.year} return against your accounts, ${r.findings.length === 1 ? "I found one thing" : `I found ${r.findings.length} things`} left behind, about ${formatCents(r.totalCents)} of refund in all (federal, estimated):\n${list}\nYou can amend until ${dayLabel(r.amendBy, { year: true })}.`;
  if (r.amendment) {
    return {
      body: `${body}\nYour amended return is ${r.amendment.status === "ready_for_review" ? "ready for you to review and sign" : r.amendment.status}.`,
      refs: { advice: true, taxYear: r.year },
      actions: [{ id: "open", label: "Review and sign", kind: "link", href: RETURN_HREF }],
    };
  }
  return {
    body: `${body}\nWant me to prepare an amended return? You'd review and sign it before anything is sent.`,
    refs: { advice: true, taxYear: r.year },
    actions: [
      { id: "tax.amend_prepare", label: "Prepare the amended return", kind: "primary" },
      { id: "open", label: "See what I found", kind: "link", href: RETURN_HREF },
    ],
  };
}

export function lastReturnReply(
  reviews: ReturnReview[],
  waiting: PriorReturnView[],
  advice: boolean,
): Message {
  if (!advice) {
    return {
      body: "Checking last year's return for money left behind will come once Jane works with a tax professional.",
      refs: {},
      actions: [{ id: "open", label: "Last year's return", kind: "link", href: RETURN_HREF }],
    };
  }
  if (reviews.length === 0) {
    return {
      body:
        waiting.length > 0
          ? "I've read a return you uploaded; confirm it and I'll check it against your accounts."
          : "Upload a copy of a return you filed (Documents, kind \"Tax return\"). I'll read it, you confirm it, and I'll look for money left behind.",
      refs: {},
      actions: [{ id: "open", label: "Last year's return", kind: "link", href: RETURN_HREF }],
    };
  }
  return {
    ...reviewMessage(reviews[0]),
    body: reviews.map((r) => reviewMessage(r).body).join("\n\n"),
  };
}
