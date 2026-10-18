// Autopilot (spec step 57): one choice that sets the standing rules (src/config/rules.ts).
// A level can only switch on rules from that list, so it can never approve moving money,
// calls, cancellations or insurance (NEVER_BY_RULE).

export type AutopilotChoice = "ask" | "safe" | "all";

export type LevelRule = { limit: number; maxAnnualCents?: number };

export const AUTOPILOT_LEVELS: Record<
  AutopilotChoice,
  { label: string; description: string; rules: Record<string, LevelRule> }
> = {
  safe: {
    label: "Handle the safe stuff",
    description:
      "Refunds for double charges, trials and fees, asking for your old price back on small increases, and asking for a lower card rate. Money only comes back to you, and you can take anything back for a day.",
    rules: {
      refund_double_charges: { limit: 5 },
      refund_unwanted_charges: { limit: 5 },
      recover_bank_fees: { limit: 5 },
      fight_price_increases: { limit: 5, maxAnnualCents: 12_000 },
      lower_card_interest: { limit: 3 },
    },
  },
  all: {
    label: "Handle everything allowed",
    description:
      "The same kinds of requests, with no limit on the size of a price increase and more each month. Moving money, phone calls, cancelling and insurance still need your yes.",
    rules: {
      refund_double_charges: { limit: 10 },
      refund_unwanted_charges: { limit: 10 },
      recover_bank_fees: { limit: 10 },
      fight_price_increases: { limit: 10, maxAnnualCents: 100_000_000 },
      lower_card_interest: { limit: 10 },
    },
  },
  ask: {
    label: "Ask me first",
    description: "Jane asks before doing anything. You answer each item on your plan.",
    rules: {},
  },
};

// The order they're offered in: the recommended one first.
export const AUTOPILOT_ORDER: readonly AutopilotChoice[] = ["safe", "all", "ask"];
export const AUTOPILOT_RECOMMENDED: AutopilotChoice = "safe";
