// Ask Jane settings (src/lib/ask).

// Most tool calls Claude may make for one answer.
export const ASK_MAX_TOOL_ROUNDS = 6;
// Most transactions one search returns.
export const ASK_SEARCH_LIMIT = 25;
// A search with no dates covers this many days back.
export const ASK_DEFAULT_SEARCH_DAYS = 90;
// Earlier messages in the conversation sent along with a new question.
export const ASK_HISTORY_MESSAGES = 10;
// Longest question accepted, in characters.
export const ASK_MAX_QUESTION = 500;
// Furthest ahead the upcoming-bills tool looks.
export const ASK_MAX_UPCOMING_DAYS = 31;
// Shown instead of an answer that failed the guardrails.
export const ASK_BLOCKED_REPLY =
  "I couldn't answer that one in a way I'm sure is right, so I'd rather not guess. Try asking about your spending, upcoming bills, or what we've found.";
// Shown when Claude isn't available.
export const ASK_UNAVAILABLE_REPLY =
  "Ask Jane isn't available right now. Your report, insights and bills pages have the same numbers.";
