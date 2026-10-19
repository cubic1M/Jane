// Jane the agent (spec steps 81–82): how much Jane says in the chat, and when. Jane's
// brain (src/lib/jane-agent/brain.ts) reads every limit from here.

// At most this many messages a day besides the morning brief, in the person's own day.
export const CHAT_DAILY_LIMIT = 5;
// And at most this many of each group a day, so one kind can't crowd out the rest.
// Keyed by message source (src/lib/jane-agent/sources).
export const CHAT_SOURCE_LIMITS: Readonly<Record<string, number>> = {
  findings: 3,
  heads_ups: 2,
  did: 2,
  plan: 1,
};

// Quiet hours in the person's timezone (users.timezone): nothing is posted from 9pm to
// 8am, unless the person opens the chat themselves.
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 8;

// The morning brief: once a day, from this hour on (or whenever the person opens the chat
// first that day). Bills due within this many days are in it.
export const BRIEF_FROM_HOUR = 7;
export const BRIEF_BILL_DAYS = 2;

// Heads-ups about deadlines this many days ahead or fewer.
export const HEADS_UP_DEADLINE_DAYS = 3;

// "I did this": things Jane did on autopilot in the last this-many days, the first time
// Jane talks to someone (afterwards, only what's new since its last message).
export const DID_LOOKBACK_DAYS = 7;

// Higher goes first. The plan comes before the findings it sums up; anything that can't
// wait (an urgent alert, a deadline, something only the person can do) comes before both.
export const MESSAGE_PRIORITY = {
  brief: 1_000,
  urgent_alert: 95,
  deadline: 90,
  waiting_on_you: 85,
  plan: 80,
  // Undo has a time limit, so Jane says so while it still works.
  rule_approval: 75,
  urgent_finding: 70,
  finding: 60,
  finished: 50,
  budget_over: 45,
  goal_behind: 40,
} as const;

// The chat page shows the last this-many messages, with "Show earlier" for more.
export const CHAT_PAGE_SIZE = 50;

// The daily run (the digest cron) reaches at most this many people, the longest since
// Jane last talked to them first.
export const CHAT_CRON_LIMIT = 200;

// Messages read from the last this-many hours to count today's and find the last one.
export const CHAT_HISTORY_HOURS = 48;

// Typing to Jane (spec step 84). The longest message the box takes, in characters.
export const CHAT_MAX_MESSAGE = 500;
// Claude sees only this many recent typed messages and answers, never the whole chat.
export const CHAT_CLAUDE_HISTORY = 10;
// Most rounds of tool calls Claude may make for one answer, like Ask (ASK_MAX_TOOL_ROUNDS).
export const CHAT_CLAUDE_MAX_TURNS = 6;
// "What's due this week" looks this many days ahead.
export const CHAT_WEEK_DAYS = 7;
// Categories named when the person asks what they spent without naming one.
export const CHAT_TOP_CATEGORIES = 3;
