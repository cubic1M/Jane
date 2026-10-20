import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { reviewMessage } from "../debt-review-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// The yearly debt review (spec step 230): once for each review Jane did, one message with
// every item's button (what she did by herself is listed, without one). Items are read fresh
// from the snapshot, so a button is only there while there is still something to tap.

export const debtReviewSource: MessageSource = {
  key: "debt_review",
  gather: (snapshot): Candidate[] => {
    const data = snapshot.debtReview;
    if (!data?.available || !data.review) return [];
    const msg = reviewMessage(data, data.review.reason);
    const needsYou = data.items.some((i) => i.status === "tap");
    return [
      {
        kind: needsYou ? "decision" : "done",
        body: msg.body,
        refs: msg.refs,
        actions: needsYou ? [...msg.actions, snoozeButton()] : msg.actions,
        dedupeKey: `debtreview:${data.review.on}`,
        priority: MESSAGE_PRIORITY.debt_review,
      },
    ];
  },
};
