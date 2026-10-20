import { formatCents } from "@/lib/money";
import {
  reviewBody,
  reviewCents,
  reviewItems,
  type ReviewInput,
} from "@/lib/insurance/review-rules";
import type { KeepCovered } from "@/lib/insurance/review";
import { lowersCover } from "@/lib/insurance/saving-rules";
import type { Reply } from "../replies";
import type { MessageAction } from "../types";
import type { InsuranceSnapshot } from "./snapshot";

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

// "Keep me covered" / "my insurance review" typed in the chat: what I'd do on a tap (a payment
// plan or discount, a call about a renewal going up), or the review waiting. Never acts itself.
export function keepCoveredReply(
  insurance: Pick<InsuranceSnapshot, "review" | "savings" | "negotiations" | "checkup"> | undefined,
  review: boolean,
): Reply {
  if (review && insurance?.review) {
    return {
      body: reviewBody(insurance.review),
      actions: reviewActions(insurance.review),
      refs: {
        ...(insurance.checkup ? { insuranceCheckupId: insurance.checkup.id } : {}),
        advice: true,
      },
    };
  }
  const same = (insurance?.savings ?? []).filter((s) => !lowersCover(s.kind));
  const calls = (insurance?.negotiations ?? []).filter((n) => n.status === "asked");
  if (same.length + calls.length === 0) {
    return {
      body: "There's nothing to do right now: I see no way to pay less for the same cover and no renewal to call about. I check your cover once a year, and Jane's review will tell you what needs a tap.",
      actions: [{ id: "open", label: "Your insurance", kind: "link", href: "/insurance" }],
      refs: {},
    };
  }
  const total = same.reduce((n, s) => n + s.yearlySavingCents, 0);
  return {
    body: [
      `I can ${[
        ...(same.length > 0
          ? [
              `pay less for the same cover (${same.length === 1 ? "a way" : `${same.length} ways`}, up to ${formatCents(total)} a year)`,
            ]
          : []),
        ...(calls.length > 0
          ? [
              `call your insurer about ${calls.length === 1 ? "a renewal" : `${calls.length} renewals`} going up`,
            ]
          : []),
      ].join(" and ")}, and your cover stays as it is.`,
      "Nothing happens until you tap. At Everything allowed I do this by myself, within your limits.",
    ].join("\n"),
    actions: [
      { id: "insurance.keep_covered", label: "Keep me covered", kind: "primary" },
      { id: "open", label: "Your insurance", kind: "link", href: "/insurance#savings" },
    ],
    refs: {},
  };
}
