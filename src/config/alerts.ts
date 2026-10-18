import type { AlertType } from "@/generated/prisma/client";

// How alerts reach people. The thresholds that decide when an alert is raised are in
// src/config/detection.ts with the other detection numbers.

// "email": emailed right away (urgent types only). "app": shown on /alerts and in the
// weekly email. "off": not raised at all.
export type AlertDelivery = "email" | "app" | "off";

export const ALERT_TYPES: readonly AlertType[] = [
  "large_charge",
  "duplicate_charge",
  "low_balance",
  "fee_charged",
  "price_increase",
  "new_subscription",
  "over_budget",
];

// Time-sensitive alerts: these can be emailed right away.
export const URGENT_ALERT_TYPES: readonly AlertType[] = [
  "large_charge",
  "duplicate_charge",
  "low_balance",
];

export const ALERT_LABELS: Record<AlertType, { label: string; description: string }> = {
  large_charge: {
    label: "Unusually large charge",
    description: "A charge much bigger than what you usually spend on that account.",
  },
  duplicate_charge: {
    label: "Possible double charge",
    description: "The same amount at the same place, twice within a day.",
  },
  low_balance: {
    label: "Low balance ahead",
    description: "Your checking account could run low before your next paycheck.",
  },
  fee_charged: {
    label: "Fee charged",
    description: "A bank or card fee, like an overdraft or late fee.",
  },
  price_increase: {
    label: "Price went up",
    description: "A subscription or bill charged more than usual.",
  },
  new_subscription: {
    label: "New subscription",
    description: "A recurring charge we hadn't seen before.",
  },
  over_budget: {
    label: "Over budget",
    description: "Spending in a category passed the monthly budget you set.",
  },
};

export const DEFAULT_ALERT_DELIVERY: Record<AlertType, AlertDelivery> = {
  large_charge: "email",
  duplicate_charge: "email",
  low_balance: "email",
  fee_charged: "app",
  price_increase: "app",
  new_subscription: "app",
  over_budget: "app",
};

// At most this many alert emails per person in any 24 hours. The rest wait for the
// weekly email.
export const ALERT_EMAILS_PER_DAY = 3;

// How many alerts /alerts shows.
export const ALERTS_PAGE_LIMIT = 50;
