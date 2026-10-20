// Asking less, at the right time (spec step 147): what Jane learns from how the person
// answers her, and the limits on it. Read by src/lib/jane-agent/attention.ts.

// How far back Jane looks at her own messages and the answers to them.
export const ATTENTION_DAYS = 60;
// The person's usual hour is known once they've answered this many times.
export const ATTENTION_MIN_ANSWERS = 5;
// Non-urgent messages wait for the usual hour, give or take this many hours...
export const ATTENTION_WINDOW_HOURS = 2;
// ...but never longer than this since Jane last said anything: nothing waits more than a day.
export const ATTENTION_HOLD_MAX_HOURS = 24;
// A kind of message is stopped after this many in a row with a button the person never
// tapped "yes" on.
export const ATTENTION_STOP_AFTER = 4;
// A channel (push or email) is learned once each has carried this many messages.
export const ATTENTION_MIN_NOTIFIED = 4;
// Never held and never stopped: urgent alerts and deadlines (heads_ups), bills to pay,
// money in motion, the brief and Jane's one-time questions, and her own note about
// stopping something.
export const ATTENTION_ALWAYS: readonly string[] = [
  "heads_ups",
  "billpay",
  "paycheck",
  "brief",
  "welcome",
  "review",
  "autopilot",
  "attention",
  // Spec step 148: the monthly report comes once a month; it's never stopped.
  "report",
];
// How Settings and the chat name each kind of message, by source.
export const ATTENTION_LABELS: Readonly<Record<string, string>> = {
  findings: "savings ideas",
  plan: "plan reminders",
  setup: "set-up suggestions",
  steps: "steps only you can do",
  budgets: "budget check-ins",
  things: "things to tick off",
  taxes: "tax suggestions",
  changes: "notes about changes",
  life: "life event questions",
  upkeep: "budget tune-ups",
  found: "insurance found from payments",
  insurance: "insurance suggestions",
  investments: "investment notes",
  debts: "debt suggestions",
  payoff: "payoff plan reminders",
  refinance: "refinance offers",
  loans: "loan suggestions",
  transfers: "balance transfer offers",
  health: "money health notes",
  saved: "savings milestones",
  checked: "nightly check notes",
};
// A message only counts as never acted on once it's had this long to be answered.
export const ATTENTION_GRACE_HOURS = 48;
