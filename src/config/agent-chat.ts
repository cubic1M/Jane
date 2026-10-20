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
  insurance: 2,
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
  // Spec step 99.
  found: 1,
  // Spec step 139.
  saved: 1,
  // Spec step 142.
  checked: 1,
  // Spec step 144.
  paycheck: 1,
  // Spec step 145: one a day; the rest wait their turn.
  billpay: 1,
  // Spec step 146.
  health: 1,
  // Spec step 147.
  attention: 1,
  // Spec step 204.
  lean: 1,
  // Spec step 255: the top few suggestions of the day (src/config/suggestions.ts).
  suggestions: 3,
  // Spec step 240.
  steady: 1,
  // Spec step 257: one question about the person at a time.
  questions: 1,
  // Spec step 208.
  unusual: 2,
  // Spec step 148.
  report: 1,
  // Spec step 128 on.
  investments: 3,
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
  // Spec step 96: the week's summary comes first, at the top of the week.
  week: 1_001,
  // Insurance (spec step 102): cover that looks missing, after budgets and goals.
  insurance_gap: 35,
  // Spec step 104: a cheaper policy for the same cover, after news (a change Jane noticed)
  // and set-up suggestions, before findings; and a reshop that found nothing better, like
  // something Jane finished.
  insurance_shop: 64,
  insurance_checked: 48,
  // Spec step 106: the coverage checkup, a heads-up that can wait.
  insurance_checkup: 46,
  // Spec step 107: a claim's next step is due, like something only the person can do.
  insurance_claim: 86,
  // Spec step 150: benefits found on a pay stub to confirm, and the short guided questions.
  benefits_found: 62,
  benefits_question: 47,
  // Spec step 151: a policy read from a document, waiting for the confirm tap.
  policy_reading: 63,
  // Spec step 153: life cover sized with quotes (demo advice), and the question before it.
  life_sized: 49,
  life_dependants: 45,
  // Spec step 154: cover changes after a life event, worth doing soon.
  cover_change: 72,
  // Spec step 155: a renewal call to make (before the renewal), its result, a claim's draft
  // to file, and the carrier's news on a filed claim.
  renewal_call: 74,
  renewal_result: 52,
  claim_draft: 82,
  claim_status: 68,
  // Spec step 196: ways to pay less for the cover the person keeps.
  saving_group: 54,
  saving_deductible: 50,
  // Spec step 197: one question about how they live, asked once.
  risk_question: 58,
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
  // Spec step 99: a policy found from payments, to confirm.
  found_policy: 63,
  // Spec step 139: a savings milestone, like something Jane finished.
  saved_milestone: 52,
  // Spec step 140: the first-run hello comes before everything, the brief included.
  welcome: 2_000,
  // Spec step 142: what Jane checked last night, after what needs the person.
  checked: 25,
  // Spec step 144: a paycheck's plan, money in motion: right after deadlines.
  paycheck: 88,
  // Spec step 145: a bill to pay on time, money in motion like a paycheck's plan.
  billpay: 87,
  // Spec step 146: the money health score, after what needs the person.
  health: 28,
  // Spec step 147: a kind Jane stopped bringing up, said once.
  attention: 30,
  // Spec step 204: income stopped; right after urgent things.
  lean: 92,
  // Spec step 255: what Jane worked out for this person, just below a finding to decide.
  suggestions: 58,
  // Spec step 240: a steady paycheck, once a month.
  steady: 86,
  // Spec step 257: a question that unlocks suggestions, after those it would unlock.
  questions: 36,
  // Spec step 208: a charge that may not be theirs; as urgent as an alert.
  unusual: 95,
  // Spec step 148: the monthly money report, once a month, after what needs the person.
  report: 40,
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
  // Spec step 134: the offer to invest every payday, and what each payday did.
  auto_invest_offer: 33,
  // Spec step 135: which account to fill first (demo advice).
  account_order: 37,
  // Spec step 137: the monthly portfolio note.
  investment_monthly: 41,
  // Spec step 157: each goal invested for its timeline (demo advice).
  goal_buckets: 35,
  // Spec step 158: saving for college (demo advice).
  college: 34,
  // Spec step 159: the HSA (demo advice) and its receipts vault.
  hsa: 33,
  // Spec step 160: too much in the employer's stock (demo advice).
  company_stock: 37,
  // Spec step 161: crypto seen, and its flags (demo advice).
  crypto: 36,
  // Spec step 162: cash earning what it should (demo advice).
  cash: 38,
  // Spec step 163: one calm message in a big drop, ahead of the other investing messages.
  steady_hand: 44,
  // Spec step 210: the match left on the table, and IRA room (demo advice).
  retirement_accounts: 40,
  // Spec step 211: the question about a past employer's 401(k), then the rollover.
  old_plan: 39,
  // Spec step 212: the retirement paycheck, from 15 years out (demo advice).
  retirement_income: 35,
  // Spec step 213: a gift link offer, and a child's Roth IRA (demo advice).
  family: 33,
  // Spec step 214: a rental's year, and paying down against investing (demo advice).
  property: 32,
  // Spec step 215: what a costly product costs, and the question that finds one (demo advice).
  costly_products: 31,
  // Spec step 216: the yearly investing review, one message (a raise puts it first).
  yearly_review: 43,
  // Spec step 231: the right investment in the right account (demo advice).
  location: 34,
  // Spec step 164: the month's summary of what Jane did by herself in investing.
  investing_summary: 40,
  auto_invest_run: 31,
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
export const CHAT_UNCAPPED_SOURCES: readonly string[] = [
  "autopilot",
  "review",
  "welcome",
  // Spec step 208: a charge that may not be theirs shouldn't wait for a quiet day; the source
  // itself brings up at most UNUSUAL_CHAT_MAX at a time.
  "unusual",
];
// Unusual-activity questions in the chat at one time.
export const UNUSUAL_CHAT_MAX = 2;

// Spec step 184: the morning brief is the day's agenda. Anything less urgent than this
// waits for it and becomes one of its lines; urgent alerts and deadlines come at once.
export const AGENDA_URGENT_PRIORITY = 90;
// The agenda lists at most this many things to say yes to (a Yes button each, like a
// bundle's: bundle.1 to bundle.5) and this many other things worth knowing.
export const AGENDA_MAX_YES = 5;
export const AGENDA_MAX_LINES = 3;
// Spec step 188: a short answer keeps at most this many list lines.
export const STYLE_LIST_LINES_SHORT = 2;

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
// Spec step 183: "Am I OK?" names at most this many bills and deadlines due within
// CHAT_WEEK_DAYS (or by the month's end for "this month"), and this many things to do.
export const WHOLE_PICTURE_DUE = 3;
export const WHOLE_PICTURE_TOP = 3;
// Categories named when the person asks what they spent without naming one.
export const CHAT_TOP_CATEGORIES = 3;

// "Can I spend $500 on food this week?": "usually" is the average of this many complete
// months of that category, and a week is a month divided by this many weeks.
export const AFFORD_USUAL_MONTHS = 3;
export const WEEKS_PER_MONTH = 4.345;

// Spec step 88: what a conversation remembers. A follow-up ("and Hulu?", "cancel it") goes
// with the last thing talked about only within this many minutes, and never from another
// day in the person's timezone.
export const CHAT_CONTEXT_MINUTES = 30;
// A clarifying question offers at most this many meanings, one button each.
export const CHAT_CLARIFY_CHOICES = 3;
// The subscriptions list names at most this many, the most expensive first.
export const CHAT_SUBSCRIPTIONS_LISTED = 8;

// Spec step 90: a purchase that doesn't fit before payday gets "Start a goal for it",
// reached this many months from now.
export const AFFORD_GOAL_MONTHS = 3;

// Spec step 92: never interrupt. While the person is chatting (they typed within this many
// minutes), Jane's own messages wait, and come after.
export const CHAT_TYPING_PAUSE_MINUTES = 10;
// Findings of the same kind become one message with a list and a Yes each: at least this
// many, at most this many in one message (one button each).
export const CHAT_BUNDLE_MIN = 2;
export const CHAT_BUNDLE_MAX = 5;

// Spec step 93: fast and reliable. The person's main numbers, sent with each free
// question, are reused for this many seconds (a tap in the chat clears them).
export const CHAT_PRIMER_CACHE_SECONDS = 60;
// If Claude hasn't started (a word, a lookup or its thinking) within this many
// milliseconds, or isn't done within the deadline, Jane answers from the rules instead.
export const CHAT_CLAUDE_FIRST_WORDS_MS = 6_000;
export const CHAT_CLAUDE_DEADLINE_MS = 20_000;
// After Claude fails, free questions get the rules' answer at once for this long, instead
// of waiting on Claude again.
export const CHAT_CLAUDE_COOLDOWN_SECONDS = 60;

// Spec step 191: Claude reads every free-text message. These kinds of message keep the
// instant rules path, because they are exact commands, tapped-for answers or fixed content:
// approving, undoing and pausing, changing an autopilot level, a plan of several steps,
// guided flows, what the person tells Jane to remember, searching the chat, the glossary,
// help and hellos. Everything else is a question for Claude with all the tools.
export const CHAT_RULES_ONLY_KINDS: readonly string[] = [
  "greeting",
  "help",
  "approve_all",
  "undo",
  "pause_autopilot",
  "autopilot_sector",
  "autopilot_overview",
  "act",
  "multi",
  "move_to_goal",
  "flow",
  "remember",
  "search",
  "learn",
];
// The most Claude may spend answering one person's messages in a day, in cents, at the model's
// listed price (MODEL_PRICES_CENTS in src/config/answer-checks.ts). Past it, the rules answer.
export const CHAT_CLAUDE_DAILY_CAP_CENTS = 25;
// /admin/chat looks back this many days for what Jane couldn't answer.
export const CHAT_UNANSWERED_DAYS = 30;

// Spec step 94: answer blocks (charts, tables, timelines, progress) are drawn in monospace
// text at most this many characters wide, so they fit a 375px phone; and hold at most this
// many rows.
export const CHAT_BLOCK_WIDTH = 34;
export const CHAT_BLOCK_ROWS = 8;

// Spec step 95: guided flows in the chat show at most this many answers as buttons.
export const CHAT_FLOW_OPTIONS = 5;

// Spec step 96: chat search shows at most this many messages, newest first.
export const CHAT_SEARCH_RESULTS = 30;
