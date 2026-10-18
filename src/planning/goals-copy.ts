// Every sentence the goals page shows about the math, checked by the recommendation
// guardrail in goals-copy.test.ts, like the debt planner's wording.

export const GOALS_COPY = {
  intro:
    "Set something you're saving for. We show how far along you are and what each month would take to get there by your date.",
  disclaimer:
    "This is math, not a recommendation. It doesn't include interest, and uses your account balance as it is today.",
  reached: "You've reached this goal.",
  datePassed: "The date has passed. Change the date to see a new monthly amount.",
  linkedNote: "Progress is the balance of the linked account.",
  manualNote: "Progress is the amount you entered.",
} as const;

// "$750.00 a month for 6 months would get there."
export function monthlyLine(monthly: string, months: number): string {
  return `${monthly} a month for ${months} month${months === 1 ? "" : "s"} would get there.`;
}

export function allGoalsCopy(): string[] {
  return [...Object.values(GOALS_COPY), monthlyLine("$750.00", 6), monthlyLine("$500.00", 1)];
}
