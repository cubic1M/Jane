// Jane in your messages (spec step 78): texts through Sendblue (iMessage, falling back to
// SMS). Every limit and timing for texts lives here.

// What the person agrees to on /settings, word for word. A new wording gets a new version,
// kept with their consent.
export const TEXT_CONSENT_VERSION = "2026-11-15";
export const TEXT_CONSENT_TEXT =
  "Jane may text you about your money: alerts, your weekly plan, and things that need you. Message and data rates may apply. Reply STOP to stop, HELP for help.";

// The verification code: digits, how long it works, and how many wrong tries it allows.
export const TEXT_CODE_DIGITS = 6;
export const TEXT_CODE_MINUTES = 10;
export const TEXT_CODE_MAX_TRIES = 5;
// Codes texted per person per window (src/config/rate-limits.ts uses this).
export const TEXT_CODE_RATE_LIMIT = { limit: 3, windowSeconds: 60 * 60 };

// Quiet hours, in the person's own timezone (users.timezone): nothing between 9pm and 8am
// except a code they just asked for and answers to their own texts. Anything else waits
// until morning.
export const TEXT_QUIET_START_HOUR = 21;
export const TEXT_QUIET_END_HOUR = 8;

// The weekly plan text: at most this many numbered items, each title cut to this length.
export const TEXT_PLAN_MAX_ITEMS = 5;
export const TEXT_PLAN_TITLE_LENGTH = 60;
// How long a plan text can be answered (the same week as a one-tap link), and how long
// after a YES that UNDO works (the hold before Jane starts, AGENT_HOLD_HOURS.text).
export const TEXT_PLAN_DAYS = 7;

// The longest text Jane sends; anything longer is cut with "…".
export const TEXT_MAX_LENGTH = 600;
// The most of an inbound text that's read or kept.
export const TEXT_INBOUND_MAX_LENGTH = 500;
// Largest webhook body accepted.
export const TEXT_WEBHOOK_MAX_BYTES = 50_000;
// Longest provider error kept on a message.
export const TEXT_ERROR_LENGTH = 300;

// Sendblue's API (docs.sendblue.com, checked Oct 18, 2026).
export const SENDBLUE_API_BASE = "https://api.sendblue.com";
// How long to wait for Sendblue before giving up (the job retries).
export const SENDBLUE_TIMEOUT_MS = 15_000;
