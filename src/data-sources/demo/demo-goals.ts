import type { PersonId } from "@/config/people";

// The sample people's savings goals (spec step 241), dated from the day the demo bank is
// linked, so the goals page and the trade-off have something real to work on. The Reyes
// family wants a trip and a kitchen redo; together they need more each month than the
// family's plan has room for, so one has to wait. Pure.

export type DemoGoal = {
  name: string;
  targetCents: number;
  savedCents: number;
  // Months from today to the date they want it by.
  inMonths: number;
};

export const DEMO_GOALS: Readonly<Partial<Record<PersonId, readonly DemoGoal[]>>> = {
  family: [
    { name: "Family trip", targetCents: 600_000, savedCents: 100_000, inMonths: 7 },
    { name: "Kitchen redo", targetCents: 2_400_000, savedCents: 200_000, inMonths: 12 },
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
