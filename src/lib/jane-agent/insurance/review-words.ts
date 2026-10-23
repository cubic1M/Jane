import { formatCents } from "@/lib/money";
import {
  reviewBody,
  reviewCents,
  reviewItems,
  type ReviewInput,
} from "@/lib/insurance/review-rules";
import type { KeepCovered } from "@/lib/insurance/review";
import type { MessageAction } from "../types";

// The yearly insurance review in the chat (spec step 202): one message, a button for every
// item. Pure.

export { reviewBody, reviewCents };

export function reviewActions(r: ReviewInput): MessageAction[] {
  const buttons = reviewItems(r).map((item): MessageAction =>
    item.button.href === null
      ? { id: "insurance.keep_covered", label: item.button.label, kind: "primary" }
      : { id: "open", label: item.button.label, kind: "link", href: item.button.href },
  );
  return [...buttons, { id: "insurance.checkup_seen", label: "Got it", kind: "secondary" }];
}

export function keptCoveredNote(done: KeepCovered): string {
  const parts = [
    ...(done.savings > 0
      ? [
          `${done.savings === 1 ? "I made 1 change" : `I made ${done.savings} changes`} to pay less for the same cover${done.yearlySavingCents > 0 ? `, about ${formatCents(done.yearlySavingCents)} a year` : ""}`,
        ]
      : []),
    ...(done.calls > 0
      ? [`I called your insurer about ${done.calls === 1 ? "a renewal" : `${done.calls} renewals`}`]
      : []),
  ];
  return `Done. ${parts.join(", and ")}. Your cover stays as it was.`;
}
