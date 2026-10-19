import type { ActionType } from "@/generated/prisma/client";

// The action agent (spec step 51): which approved actions it works itself, and how
// patiently. Everything else stays with the team.

// Actions the agent works by email (or, for some cancellations, with a link for the
// person). Bill negotiation needs a call (step 54).
export const AGENT_ACTION_TYPES: readonly ActionType[] = [
  "request_refund",
  "fight_price_increase",
  "recover_bank_fees",
  "cancel_subscription",
  // By phone (AGENT_CALL_TYPES below).
  "negotiate_bill",
];

// Days to wait for a reply before following up, and how many follow-ups before passing
// the action to the team.
export const AGENT_FOLLOW_UP_DAYS = 3;
export const AGENT_MAX_FOLLOW_UPS = 2;

// The longest email body the agent sends or keeps from a reply.
export const AGENT_MAX_BODY = 4_000;

// How the agent signs its emails.
export const AGENT_SIGNATURE = "Jane, an assistant writing for a customer";

// Refunds seen in the person's own transactions (spec step 52): money coming back from the
// company (or a fee reversal on the account), on or after the day it was approved, of at
// least this share of what was asked for. Partial refunds count for what came back.
export const REFUND_MATCH_MIN_SHARE = 0.5;
// Actions whose success is money coming back.
export const REFUND_ACTION_TYPES: readonly ActionType[] = ["request_refund", "recover_bank_fees"];

// Cancellations (spec step 53). A cancellation is confirmed by the company's written reply,
// or, when the person cancels on the company's own page, by no charge arriving this many
// days after the next one was due.
export const CANCEL_CONFIRM_GRACE_DAYS = 5;
// When we can't tell how often it charged, wait this long instead.
export const CANCEL_CONFIRM_DEFAULT_DAYS = 35;

// What the agent asks for when the person changed the plan item (src/config/plan.ts).
export const AGENT_REQUESTS: Record<string, Record<string, string | null>> = {
  cancel_subscription: {
    cancel: null,
    downgrade:
      "move the account to the cheapest plan with the same service instead of cancelling, and confirm the change in writing",
  },
  fight_price_increase: {
    old_price: null,
    loyalty_discount: "offer a loyalty discount on the current price",
    cheaper_plan: "move the account to a cheaper plan with the same service",
  },
};

// Phone negotiation (spec step 54): bills the agent calls about. A call only ever happens
// with the person's own yes on that bill; no standing rule or automatic follow-up starts
// one (checked in src/lib/voice/calls.ts as well as NEVER_BY_RULE).
export const AGENT_CALL_TYPES: readonly ActionType[] = ["negotiate_bill"];

// How long the agent waits before acting on an approval the person didn't make in the app,
// so "Take it back" really works: a standing rule's (the person hasn't looked at it) and a
// one-tap link's (spec step 60). Approvals in the app start at once.
export const AGENT_HOLD_HOURS: Partial<Record<"rule" | "link" | "auto", number>> = {
  rule: 24,
  link: 1,
};

// Switching to a picked option (spec step 77, src/lib/agent/switch.ts).
// How long Jane watches for the switch before passing it to the team.
export const SWITCH_WATCH_DAYS = 45;
// A cheaper tier's charge may be this much above its listed price (tax) and still count.
export const SWITCH_PRICE_TOLERANCE_CENTS = 150;
// A transfer out of at least this share of the idle cash counts as the money moved.
export const SWITCH_MIN_MOVED_SHARE = 0.5;
