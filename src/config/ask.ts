// Settings for the read-only tools over the person's data (src/lib/ask/tools.ts), which the
// chat's Claude uses, and its fallback when an answer fails the guardrails.

// Most transactions one search returns.
export const ASK_SEARCH_LIMIT = 25;
// A search with no dates covers this many days back.
export const ASK_DEFAULT_SEARCH_DAYS = 90;
// Furthest ahead the upcoming-bills tool looks.
export const ASK_MAX_UPCOMING_DAYS = 31;
// Shown instead of an answer that failed the guardrails.
export const ASK_BLOCKED_REPLY =
  "I couldn't answer that one in a way I'm sure is right, so I'd rather not guess. Try asking about your spending, upcoming bills, or what we've found.";
