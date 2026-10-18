import type { ActionType } from "@/generated/prisma/client";

// Merchant outcomes (src/lib/merchant-outcomes.ts).

// Nothing is shown for a merchant until it has this many finished actions of a kind:
// fewer would be noise, and could point to one person's case.
export const OUTCOME_MIN_CASES = 5;

// The actions that happen at a merchant, so their outcomes say something about it.
export const OUTCOME_ACTION_TYPES: readonly ActionType[] = [
  "cancel_subscription",
  "fight_price_increase",
  "request_refund",
  "negotiate_bill",
];
