import type { ActionType } from "@/generated/prisma/client";

// The action agent (spec step 51): which approved actions it works itself, and how
// patiently. Everything else stays with the team.

// Actions the agent works by email. More are added as their playbooks are proven
// (step 53 adds cancellations).
export const AGENT_ACTION_TYPES: readonly ActionType[] = [
  "request_refund",
  "fight_price_increase",
  "recover_bank_fees",
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
