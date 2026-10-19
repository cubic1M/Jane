// The nightly controller run (spec step 142): every sector's checks for one person, in this
// order, within a time budget. Each step's code is its sector's own; this is only the order.

export const CONTROLLER_STEPS = [
  "sync",
  "changes",
  "insurance",
  "debt",
  "taxes",
  "investing",
  "goals",
  // Spec step 144: transfers that went through, and paychecks' plans.
  "money",
] as const;
export type ControllerStep = (typeof CONTROLLER_STEPS)[number];

export const CONTROLLER_STEP_LABELS: Record<ControllerStep, string> = {
  sync: "Bank",
  changes: "Changes",
  insurance: "Insurance",
  debt: "Debt",
  taxes: "Taxes",
  investing: "Investing",
  goals: "Goals and budgets",
  money: "Money moves",
};

// One person's run stops starting new steps after this long; the rest wait for the next
// night (and say so in the log).
export const CONTROLLER_BUDGET_MS = 25_000;
// The cron works through people's runs for at most this long, then leaves the rest queued
// for the next job runner.
export const CONTROLLER_CRON_BUDGET_MS = 240_000;
// A bank is synced again when it last synced this long ago.
export const CONTROLLER_SYNC_HOURS = 20;
// "What I checked last night" is said in the chat for a run this recent.
export const CONTROLLER_NEWS_HOURS = 30;
