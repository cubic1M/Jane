import type { LifeEventKind } from "@/config/life-events";

// Life events spotted from someone's money (spec step 100): the signals for each, how many
// it takes before Jane asks, and what it does on its own on Yes. The checklists themselves
// are in src/config/life-events.ts (step 72).

// Signals count only inside this window, and Jane asks only once at least this many kinds
// of signal agree: one signal never asks.
export const LIFE_SIGNAL_DAYS = 60;
export const LIFE_SIGNALS_NEEDED = 2;

// Merchant words (normalized merchant keys) that point to each life event.
export const MOVING_MERCHANTS: readonly string[] = [
  "u-haul",
  "u haul",
  "uhaul",
  "penske",
  "budget truck",
  "pods",
  "two men and a truck",
  "moving",
  "movers",
  "storage",
  "extra space",
  "public storage",
  "cubesmart",
];
export const BABY_MERCHANTS: readonly string[] = [
  "buybuy baby",
  "babylist",
  "carter s",
  "carters",
  "pampers",
  "huggies",
  "gerber",
  "enfamil",
  "similac",
  "honest company",
  "baby",
];
// A hospital bill this big or more (with "hospital", "maternity" or "birth" in it).
export const BABY_HOSPITAL_MIN_CENTS = 20_000;
export const BABY_HOSPITAL_WORDS = /\b(?:hospital|maternity|birth|obstetric|ob ?gyn|labor)\b/i;
// Furniture spending this big in the window counts toward moving.
export const MOVING_FURNITURE_MIN_CENTS = 50_000;
// A paycheck this much bigger or smaller than before counts toward a new job.
export const NEW_JOB_PAY_CHANGE_SHARE = 0.1;

// What Jane does on its own on Yes, at every autopilot level (nothing here moves money):
// - budgets: categories to budget at their usual month (rounded up like the suggestions),
//   when the person doesn't have one yet; ticks the checklist's "budget" item.
// - insurance: a reminder to review cover, this many days out.
// - reminders: deadlines for the checklist items that have a date, this many days out.
export type LifeAutomation = {
  budgets: readonly string[];
  insurance: { title: string; inDays: number } | null;
  reminders: readonly { item: string; title: string; inDays: number }[];
};

export const LIFE_AUTOMATION: Record<LifeEventKind, LifeAutomation> = {
  moving: {
    budgets: ["Home"],
    insurance: { title: "Review your insurance for the new address", inDays: 14 },
    reminders: [
      { item: "deposit", title: "Check your old security deposit came back", inDays: 45 },
      { item: "mail", title: "Forward your mail with the post office", inDays: 7 },
    ],
  },
  new_job: {
    budgets: ["Transportation"],
    insurance: { title: "Review your insurance with your new job's benefits", inDays: 30 },
    reminders: [
      { item: "benefits", title: "Sign up for benefits at your new job", inDays: 30 },
      { item: "retirement", title: "Enroll in your new job's retirement plan", inDays: 30 },
    ],
  },
  new_baby: {
    budgets: ["Shopping", "Personal care"],
    insurance: { title: "Review your life and health insurance for the baby", inDays: 30 },
    reminders: [
      { item: "health-plan", title: "Add the baby to your health plan", inDays: 30 },
      { item: "beneficiaries", title: "Update the beneficiaries on your accounts", inDays: 60 },
    ],
  },
};
