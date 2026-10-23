import type { PersonId } from "@/config/people";

// The sample people's savings goals (spec step 241), dated from the day the demo bank is
// linked, so the goals page and the trade-off have something real to work on. Dan and Lena
// want a trip to Japan and a kitchen remodel before retiring; together they need more each
// month than their plan has room for, so one has to wait. Pure.

export type DemoGoal = {
  name: string;
  targetCents: number;
  savedCents: number;
  // Months from today to the date they want it by.
  inMonths: number;
};

export const DEMO_GOALS: Readonly<Partial<Record<PersonId, readonly DemoGoal[]>>> = {
  preretire: [
    { name: "Trip to Japan", targetCents: 1_500_000, savedCents: 300_000, inMonths: 7 },
    { name: "Kitchen remodel", targetCents: 9_000_000, savedCents: 1_000_000, inMonths: 12 },
  ],
};

// The day `inMonths` from `today` (YYYY-MM-DD), on the same day of the month (the 28th at most).
export function goalDate(today: string, inMonths: number): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + inMonths, Math.min(d, 28))).toISOString().slice(0, 10);
}

export const demoGoalsFor = (person: string | undefined, today: string) =>
  (DEMO_GOALS[person as PersonId] ?? []).map((g) => ({
    name: g.name,
    targetCents: g.targetCents,
    savedCents: g.savedCents,
    targetDate: goalDate(today, g.inMonths),
  }));
