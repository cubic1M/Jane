// Claude as strategist (spec step 256): once a week Claude looks at the whole profile and
// every detector's result and proposes combinations no single detector sees. These are its
// limits.

// A person's ideas are refreshed this often; the run costs from the same daily cap as the
// chat (CHAT_PERSON_DAILY_CAP_CENTS).
export const STRATEGIST_EVERY_DAYS = 7;
// Claude's rounds of lookups in one run, and what it may keep.
export const STRATEGIST_MAX_TURNS = 6;
export const STRATEGIST_MAX_TOKENS = 4_000;
export const STRATEGIST_MAX_IDEAS = 3;
// An idea combines this many detectors' suggestions, no fewer and no more.
export const STRATEGIST_MIN_PARTS = 2;
export const STRATEGIST_MAX_PARTS = 4;
// An idea stays in the ranking this long, as long as the suggestions it rests on still hold.
export const STRATEGIST_IDEA_DAYS = 14;
// Its words are kept to this length.
export const STRATEGIST_TITLE_MAX = 140;
export const STRATEGIST_BODY_MAX = 600;

// The read-only chat tools the strategist may look things up with (src/lib/jane-agent
// /claude-tools.ts), beside its own two: suggestions_now and propose_idea.
export const STRATEGIST_LOOKUP_TOOLS: readonly string[] = [
  "my_profile",
  "whole_picture",
  "priorities",
  "health_score",
  "safe_to_spend",
  "what_if",
  "long_view",
];

// The capability and topic ideas are tagged with, so the reach scoreboard (step 258) can
// tell them apart.
export const STRATEGIST_CAPABILITY = "strategist";
export const STRATEGIST_TOPIC = "strategist";
