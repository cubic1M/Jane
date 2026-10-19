import { DEBT_MESSAGE_PRIORITY, DEBT_SOURCE_LIMITS } from "@/config/debt";

// Jane the agent (spec steps 81–82): how much Jane says in the chat, and when. Jane's
// brain (src/lib/jane-agent/brain.ts) reads every limit from here.

// At most this many messages a day besides the morning brief, in the person's own day.
export const CHAT_DAILY_LIMIT = 5;
// And at most this many of each group a day, so one kind can't crowd out the rest.
// Keyed by message source (src/lib/jane-agent/sources).
export const CHAT_SOURCE_LIMITS: Readonly<Record<string, number>> = {
  // Loans and debt (spec Phase Y, src/config/debt.ts).
  ...DEBT_SOURCE_LIMITS,
  findings: 3,
  // Insurance (spec Phase X).
  insurance: 1,
  heads_ups: 2,
  did: 2,
  plan: 1,
  // Spec step 83.
  autopilot: 1,
  setup: 2,
  steps: 2,
  budgets: 1,
  things: 1,
  // Taxes (spec steps 118–127).
  taxes: 2,
  // Spec step 97.
  changes: 2,
  // Spec step 100.
  life: 1,
  // Spec step 101.
  upkeep: 2,
  // Spec step 128 on.
  investments: 2,
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
  // Loans and debt (spec Phase Y, src/config/debt.ts).
  ...DEBT_MESSAGE_PRIORITY,
  brief: 1_000,
  // Insurance (spec step 102): cover that looks missing, after budgets and goals.
  insurance_gap: 35,
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
  // Spec step 83. A step only the person can do on something Jane is working on (a
  // company's question, an offer made on a call, a cancel page, a sign-up link) comes
  // right after urgent alerts and deadlines; the autopilot question before the plan; set-up suggestions after
  // time-sensitive findings, before the rest; a budget nearly used up just under one gone
  // over; a loan with nothing linked last.
  agent_step: 87,
  autopilot: 82,
  setup: 65,
  budget_nearly_over: 44,
  asset_prompt: 30,
  // Spec step 97: a change Jane noticed is news, so it comes before set-up suggestions and
  // findings that can wait (a price rise's finding is asked about in the change's own
  // heads-up).
  change: 66,
  // Spec step 100: a life event spotted, once, before set-up suggestions.
  life_event: 67,
  // Spec step 101: a budget tune-up or a transfer to count, before set-up suggestions; the
  // weekly review comes right after the brief.
  upkeep: 64,
  review: 900,
  // Spec step 128: what's in investment accounts, the first time Jane sees it.
  investments: 32,
  // Spec step 129: the investor-profile questions, which later investment steps wait on.
  investment_profile: 34,
  // Spec step 130: costly funds with a lower-cost equivalent (demo advice).
  investment_fees: 36,
  // Spec step 131: the portfolio review's changes (demo advice).
  investment_review: 38,
  // Spec step 132: behind for retirement, or missing employer match money (demo advice).
  retirement: 39,
} as const;

// The chat page shows the last this-many messages, with "Show earlier" for more.
export const CHAT_PAGE_SIZE = 50;

// The daily run (the digest cron) reaches at most this many people, the longest since
// Jane last talked to them first.
export const CHAT_CRON_LIMIT = 200;

// Messages read from the last this-many hours to count today's and find the last one.
export const CHAT_HISTORY_HOURS = 48;

// Spec step 83: sources whose messages don't count toward the daily limit, like the brief:
// the one-time autopilot question, so it never pushes a finding out on the first day.
export const CHAT_UNCAPPED_SOURCES: readonly string[] = ["autopilot", "review"];

// Spec step 83: a budget counts as nearly over once this share of it is spent this month.
export const BUDGET_NEARLY_OVER_SHARE = 0.9;
// Typing to Jane (spec step 84). The longest message the box takes, in characters.
export const CHAT_MAX_MESSAGE = 500;
// Claude sees only this many recent typed messages and answers, never the whole chat.
export const CHAT_CLAUDE_HISTORY = 10;
// Most rounds of tool calls Claude may make for one answer, like Ask (ASK_MAX_TOOL_ROUNDS).
export const CHAT_CLAUDE_MAX_TURNS = 6;
// How hard Claude thinks before answering in the chat: low keeps answers quick, and the
// person's main numbers come with the question (CHAT_PRIMER_TOOLS) so most need no lookup.
export const CHAT_CLAUDE_EFFORT = "low";
// When an answer fails the guardrails, Claude is told why and may answer again this many
// times before the person gets the safe fallback (ASK_BLOCKED_REPLY).
export const CHAT_CLAUDE_REWRITES = 1;
// Looked up before Claude is asked, and sent with the question.
export const CHAT_PRIMER_TOOLS = [
  "safe_to_spend",
  "coming_up",
  "spending_by_category",
  "budgets",
  "goals",
  "open_findings",
  "subscriptions",
] as const;
// finding_details lists Jane's pick and at most this many runners-up.
export const CHAT_RUNNERS_UP = 2;
// "What's due this week" looks this many days ahead.
export const CHAT_WEEK_DAYS = 7;
// Categories named when the person asks what they spent without naming one.
export const CHAT_TOP_CATEGORIES = 3;

// "Can I spend $500 on food this week?": "usually" is the average of this many complete
// months of that category, and a week is a month divided by this many weeks.
export const AFFORD_USUAL_MONTHS = 3;
export const WEEKS_PER_MONTH = 4.345;
