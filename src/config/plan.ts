import type { ActionType, FindingType } from "@/generated/prisma/client";

// Jane's plan (spec step 49): what the person can change before saying yes, and how the
// plan is ordered.

export type PlanChoiceOption = {
  key: string;
  label: string;
  kind: "choice";
  choices: readonly { value: string; label: string }[];
  // The first choice is Jane's default.
};

export type PlanAmountOption = {
  key: string;
  label: string;
  kind: "amount";
  // Shown under the field; empty means Jane's own estimate.
  hint: string;
  // Whole dollars, inclusive.
  min: number;
  max: number;
};

export type PlanOption = PlanChoiceOption | PlanAmountOption;

// Options per action. Actions with none have no "Change" button.
export const PLAN_OPTIONS: Record<ActionType, readonly PlanOption[]> = {
  cancel_subscription: [
    {
      key: "plan",
      label: "What to do",
      kind: "choice",
      choices: [
        { value: "cancel", label: "Cancel it" },
        { value: "downgrade", label: "Switch to a cheaper plan" },
      ],
    },
  ],
  fight_price_increase: [
    {
      key: "ask",
      label: "What to ask for",
      kind: "choice",
      choices: [
        { value: "old_price", label: "My old price" },
        { value: "loyalty_discount", label: "A loyalty discount" },
        { value: "cheaper_plan", label: "A cheaper plan" },
      ],
    },
  ],
  negotiate_bill: [
    {
      key: "targetMonthly",
      label: "Price to aim for, per month ($)",
      kind: "amount",
      hint: "Leave empty and we aim for the top of the typical price range.",
      min: 1,
      max: 1_000,
    },
  ],
  request_refund: [
    {
      key: "method",
      label: "How",
      kind: "choice",
      choices: [
        { value: "refund", label: "Ask the company for a refund" },
        { value: "dispute", label: "Dispute it with my card" },
      ],
    },
  ],
  move_idle_cash: [
    {
      key: "keepInChecking",
      label: "Keep this much in checking ($)",
      kind: "amount",
      hint: "Leave empty and we keep three months of your spending.",
      min: 0,
      max: 1_000_000,
    },
  ],
  insurance_reshop: [
    {
      key: "coverage",
      label: "Coverage",
      kind: "choice",
      choices: [
        { value: "same", label: "Keep the same coverage" },
        { value: "open", label: "Show me options with less coverage too" },
      ],
    },
  ],
  recover_bank_fees: [],
  card_interest: [],
  review_cash_flow: [],
};

// Time-sensitive findings come first (a refund window closing, a balance about to run
// low); the rest by money a year, largest first.
export const PLAN_URGENT_FINDING_TYPES: readonly FindingType[] = [
  "low_balance_risk",
  "duplicate_charge",
  "charge_after_cancel",
  "trial_conversion",
];
