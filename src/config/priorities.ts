import type { FindingType } from "@/generated/prisma/client";

// The next best thing to do (spec step 143): every open finding, offer and task scored by
// the money it saves or earns per minute of the person's time, how urgent it is and how sure
// Jane is. These are the weights; src/planning/priorities.ts does the sums.

// score = VALUE * log10(1 + dollars a year per minute) + URGENCY * urgency (0 to 1)
//       + CONFIDENCE * confidence (0 to 1)
export const PRIORITY_WEIGHTS = { value: 1, urgency: 3, confidence: 0.5 } as const;

// Urgency is 1 when something is due within this many days (or overdue), falling to 0 at
// the horizon.
export const URGENT_WITHIN_DAYS = 3;
export const URGENCY_HORIZON_DAYS = 30;
// Findings that are time-sensitive by their nature (money to claw back soon, a balance about
// to run low) count this urgent without a date.
export const URGENT_FINDING_URGENCY = 0.8;
// A task only the person can do holds up Jane's work: this urgent.
export const TASK_URGENCY = 0.6;

// Minutes of the person's time. A Yes Jane then handles is one tap; a refinance means an
// application; a step only the person can do is a few minutes.
export const MINUTES = {
  tap: 1,
  task: 5,
  application: 15,
  deadline: 5,
} as const;
// Findings that are more than a tap for the person even after the Yes.
export const FINDING_MINUTES: Partial<Record<FindingType, number>> = {
  idle_cash: 10,
  card_interest: 2,
  bill_negotiation: 2,
};

// How sure Jane is, 0 to 1.
export const CONFIDENCE_SCORE = { high: 1, medium: 0.7, low: 0.4 } as const;

// /jane shows this many of the things that matter most.
export const TOP_THINGS = 3;

// A scan suggestion's confidence percentage (spec step 254) as the ranked list's three steps.
export const SUGGESTION_CONFIDENCE_FROM = { high: 80, medium: 50 } as const;
