import type { Decision } from "@/planning/debt-decisions";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's straight answers to debt and credit decisions (src/planning/debt-decisions.ts): up
// to three sentences from the person's numbers, a link to the detail, and the demo advice
// label when the answer picks one.

const LABELS: Readonly<Record<string, string>> = {
  "/loans/interest": "Your card interest",
  "/loans/refinance": "Loan offers",
  "/loans/credit": "Your credit",
  "/loans/tight": "A tight month",
  "/loans/student": "Student loans",
};

export const decisionLink = (href: string): MessageAction => ({
  id: "open",
  label: LABELS[href] ?? "See the detail",
  kind: "link",
  href,
});

export function decisionReply(d: Decision): Reply {
  return {
    body: d.sentences.join(" "),
    actions: [decisionLink(d.href)],
    refs: d.advice ? { advice: true } : {},
  };
}

// Every dollar amount written in the sentences, in cents, so the guardrails can tell the
// figures come from the person's own numbers.
export function centsIn(sentences: readonly string[]): number[] {
  return [...sentences.join(" ").matchAll(/\$([\d,]+(?:\.\d+)?)/g)].map((m) =>
    Math.round(Number(m[1].replaceAll(",", "")) * 100),
  );
}
