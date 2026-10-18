import type { ActionType, FindingType } from "@/generated/prisma/client";

// Standing rules (spec step 50): the things a person can pre-approve. A plan item that
// matches an enabled rule is approved without asking, up to the rule's monthly limit, and
// the person can take it back for a day.

export type RuleDefinition = {
  key: string;
  label: string;
  description: string;
  findingTypes: readonly FindingType[];
  // Rules with an amount only approve findings worth this much a year or less.
  maxAmount?: { label: string; defaultCents: number };
};

export const STANDING_RULES: readonly RuleDefinition[] = [
  {
    key: "refund_double_charges",
    label: "Ask for refunds on double charges",
    description: "When the same charge shows up twice, Jane asks for the second one back.",
    findingTypes: ["duplicate_charge"],
  },
  {
    key: "refund_unwanted_charges",
    label: "Ask for refunds after trials and cancellations",
    description:
      "When a free trial turns into a charge, or a cancelled service charges again, Jane asks for the money back.",
    findingTypes: ["trial_conversion", "charge_after_cancel"],
  },
  {
    key: "recover_bank_fees",
    label: "Ask my bank to refund fees",
    description: "Overdraft, late and other fees: Jane asks the bank to take them back.",
    findingTypes: ["bank_fees"],
  },
  {
    key: "fight_price_increases",
    label: "Push back on price increases",
    description: "When a subscription or bill goes up, Jane asks for the old price.",
    findingTypes: ["price_increase"],
    maxAmount: { label: "Only increases up to this much a year ($)", defaultCents: 12_000 },
  },
  {
    key: "lower_card_interest",
    label: "Ask my card for a lower interest rate",
    description: "When you pay card interest, Jane asks the card company for a lower rate.",
    findingTypes: ["card_interest"],
  },
];

// Approvals a rule may make in a calendar month: the choices offered, and the default.
export const RULE_MONTHLY_LIMITS = [1, 3, 5, 10] as const;
export const RULE_DEFAULT_MONTHLY_LIMIT = 3;

// How long a rule's approval can be taken back, if the work hasn't started.
export const RULE_UNDO_HOURS = 24;

// Never approved by a rule, whatever the person sets: moving money, phone calls,
// cancelling things they use, and insurance. These always need a yes on the item itself.
export const NEVER_BY_RULE: readonly ActionType[] = [
  "move_idle_cash",
  "negotiate_bill",
  "insurance_reshop",
  "cancel_subscription",
  "review_cash_flow",
];
