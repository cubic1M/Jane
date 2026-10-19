import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { REVIEW_FROM_HOUR } from "@/config/plan-upkeep";
import { addDays } from "@/detection/units";
import { weeklyReview } from "../replies-review";
import type { MessageSource } from "./source";

// The weekly review (spec step 101): on the last day of the person's week (Sunday), from
// the evening. Once a week, outside the daily limits like the brief; one decision at most.
export const reviewSource: MessageSource = {
  key: "review",
  gather(snapshot, { now, local }) {
    if (local.date !== addDays(snapshot.weekStart, 6)) return [];
    if (local.hour < REVIEW_FROM_HOUR) return [];
    const review = weeklyReview(snapshot, now);
    return [
      {
        kind: review.refs.findingId ? "decision" : "done",
        body: review.body,
        refs: review.refs,
        actions: review.actions,
        dedupeKey: snapshot.weekStart,
        priority: MESSAGE_PRIORITY.review,
      },
    ];
  },
};
