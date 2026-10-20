import { REVIEW_REASON_TEXT, type ReviewReason } from "@/config/debt-review";
import type { DebtReview, ReviewItem, ReviewTap } from "@/lib/debt-review";
import { askButton } from "./card-interest-replies";
import { payButton } from "./credit-building-replies";
import { doneButton } from "./credit-goal-replies";
import { sentButton } from "./home-equity-replies";
import type { Reply } from "./replies";
import type { MessageAction, MessageRefs } from "./types";

// Jane's debt review in the chat (spec step 230), from src/lib/debt-review.ts. Pure. One
// message with every item that waits for a tap, each with its own button; what Jane did by
// herself is listed without one.

export const REVIEW_PAGE: MessageAction = {
  id: "open",
  label: "See the review",
  kind: "link",
  href: "/loans/review",
};

const MARK = { done: "Done", tap: "Needs you", ok: "Fine" } as const;

export function itemLine(i: ReviewItem): string {
  return `- ${i.title} (${MARK[i.status]}): ${i.text}`;
}

// The button an item's tap becomes, with the refs the button's handler reads.
export function tapButton(tap: ReviewTap): { action: MessageAction; refs: MessageRefs } {
  switch (tap.kind) {
    case "pay":
      return {
        action: payButton(),
        refs: { creditStatement: { accountId: tap.accountId, closesOn: tap.closesOn } },
      };
    case "ask":
      return { action: askButton(tap.card), refs: { cardRate: { id: tap.requestId } } };
    case "sent":
      return { action: sentButton(tap.which), refs: { homeRequest: tap.which } };
    case "goal":
      return { action: doneButton(), refs: { creditGoalId: tap.goalId } };
    case "link":
      return { action: { id: "open", label: tap.label, kind: "link", href: tap.href }, refs: {} };
  }
}

// The review as one message: its body, a button for each item that has one (the button
// ids go in refs.reviewButtons so the message stays open until each is used), and the refs
// those buttons need.
export function reviewMessage(
  data: DebtReview,
  reason: ReviewReason,
): { body: string; actions: MessageAction[]; refs: MessageRefs } {
  const actions: MessageAction[] = [];
  const refs: MessageRefs = data.advice ? { advice: true } : {};
  const buttons: string[] = [];
  for (const i of data.items) {
    if (i.status !== "tap" || !i.tap) continue;
    const t = tapButton(i.tap);
    actions.push(t.action);
    Object.assign(refs, t.refs);
    if (t.action.kind !== "link") buttons.push(t.action.id);
  }
  if (buttons.length > 0) refs.reviewButtons = buttons;
  const waiting = data.items.filter((i) => i.status === "tap").length;
  const done = data.items.filter((i) => i.status === "done").length;
  const head = `${REVIEW_REASON_TEXT[reason]}: ${
    waiting === 0
      ? done > 0
        ? "I handled what I could and nothing is waiting on you."
        : "everything checks out and nothing is waiting on you."
      : `${waiting} ${waiting === 1 ? "thing needs" : "things need"} you${done > 0 ? `, and I handled ${done}` : ""}.`
  }`;
  return {
    body: [head, ...data.items.map(itemLine)].join("\n"),
    actions: [...actions, REVIEW_PAGE],
    refs,
  };
}

export function debtReviewReply(data: DebtReview): Reply {
  if (!data.available) {
    return {
      body: "I don't see a debt with a balance, so there's nothing to review yet.",
      actions: [],
      refs: {},
    };
  }
  const msg = reviewMessage(data, data.review?.reason ?? "asked");
  const level =
    data.level === "ask"
      ? "At Ask me first I only list and draft; every step is your tap."
      : data.level === "safe"
        ? "At Handle the safe stuff I pay before a statement closes on my own, within your debt caps."
        : "At Handle everything I also send the next lower-rate request myself.";
  return {
    body: [
      msg.body.replace(/^[^:]+: /, "Your debt review: "),
      level,
      data.review ? `Last done ${data.review.on}.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    actions: msg.actions,
    refs: msg.refs,
  };
}
