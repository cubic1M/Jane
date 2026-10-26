// Jane's chat messages as notifications (spec step 85): which messages go out, how many,
// and how long their email links work. Quiet hours are the chat's own
// (src/config/agent-chat.ts), through src/lib/jane-agent/quiet-hours.ts.

// How the person hears from Jane. "push": phone notifications, or an email while no device
// has them turned on. "email": email only. "both": both. "off": only in the app.
export const CHAT_NOTIFY_CHANNELS = ["push", "email", "both", "off"] as const;
export type ChatNotifyChannel = (typeof CHAT_NOTIFY_CHANNELS)[number];
export const DEFAULT_CHAT_NOTIFY_CHANNEL: ChatNotifyChannel = "push";

// The kinds of message that can go out, and whether they do unless the person says
// otherwise. The morning brief is opt-in; what the person typed and Jane's replies to it
// (step 84) never go out: the person is in the app.
export const CHAT_NOTIFY_KINDS = ["decision", "heads_up", "done", "brief"] as const;
export type ChatNotifyKind = (typeof CHAT_NOTIFY_KINDS)[number];
export const DEFAULT_CHAT_NOTIFY_KINDS: Readonly<Record<ChatNotifyKind, boolean>> = {
  decision: true,
  heads_up: true,
  done: true,
  brief: false,
};

// What each kind is called in Settings.
export const CHAT_NOTIFY_KIND_LABELS: Readonly<Record<ChatNotifyKind, string>> = {
  decision: "Things to decide, and your week's plan",
  // Heads-ups about alerts go out as alerts (src/lib/alerts.ts), never twice.
  heads_up: "Heads-ups: deadlines, budgets, goals and steps only you can take",
  done: "What I did for you, with Undo",
  brief: "The morning brief",
};

// At most this many messages go out (pushed or emailed) in any 24 hours.
export const CHAT_NOTIFY_DAILY_LIMIT = 6;
// At most this many of Jane's emails in any 24 hours; each has every message waiting
// (real-user QA: a new person got two a day, on top of their alerts and the weekly email). Urgent
// messages always get through, in an email of their own when today's has gone.
export const CHAT_EMAILS_PER_DAY = 1;
// Urgent, for that: a bill to pay, a payday's split, a deadline days away, a paycheck that
// stopped, an urgent alert (MESSAGE_PRIORITY in src/config/agent-chat.ts, from billpay up). The
// daily brief never counts, however high it is placed.
export const CHAT_URGENT_FROM_PRIORITY = 87;
// At most this many messages in one email, most important first.
export const CHAT_EMAIL_MAX_MESSAGES = 5;
// A message goes by email only once it has sat unread this long, so someone looking at
// the chat isn't emailed what they're reading. Push goes straight away.
export const CHAT_EMAIL_AFTER_MINUTES = 60;
// Messages older than this never go out: by then it's old news, and it's in the chat.
export const CHAT_NOTIFY_MAX_AGE_HOURS = 24;

// A push notification's text is the message, cut to this many characters.
export const CHAT_PUSH_BODY_LENGTH = 180;
// And at most this many of the message's buttons as notification buttons.
export const CHAT_PUSH_BUTTONS = 2;
