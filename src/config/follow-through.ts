// Following through on a Yes (src/planning/follow-through.ts). All marked FOR REVIEW.

// A Yes with nothing done: the first nudge this long after it, then this long between nudges, at
// most this many in all. It stops as soon as the person acts or says no.
export const NUDGE_AFTER_DAYS = 7;
export const NUDGE_EVERY_DAYS = 14;
export const NUDGE_MAX = 2;

// A fix that failed comes back with its next step at most this many times. A clean no is final.
export const COMEBACK_MAX = 2;

// A Yes'd suggestion no scan has found for this long is said by the follow-up card, since the scan
// can't bring it back as a suggestion.
export const COMEBACK_LAST_SEEN_DAYS = 2;

// How sure Jane is, shown with each: the person's own answer, or what their statements show.
export const NUDGE_CONFIDENCE = {
  percent: 100,
  reason: "you said yes and haven't marked it done",
};
export const FAILED_CONFIDENCE_REASON = "what your later transactions show";
