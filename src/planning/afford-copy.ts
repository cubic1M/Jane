import { MAX_AFFORD_CENTS, MAX_GOAL_MONTHS } from "@/config/afford";
import { formatCents } from "@/lib/money";

// Every sentence the "Can I afford this?" page shows (spec step 69). Kept in one place so
// a test can check none of it recommends a choice, like the debt planner's wording.

export const AFFORD_COPY = {
  title: "Can I afford this?",
  intro:
    "Enter a purchase or a change to what goes out each month. We show what it does to safe to spend, your goals and your checking balance over the next 12 months.",
  disclaimer:
    "This is math, not a recommendation. It counts your checking balance, expected deposits, regular bills and your usual everyday spending, the same figures What if uses. Bills and spending are estimates from your past months.",
  kinds: {
    purchase: "A one-time purchase",
    more: "More going out each month",
    less: "Less going out each month",
  },
  goalsHeading: "Your goals",
  goalsNote:
    "Each line shows what would happen if the money came from that goal. Safe to spend already sets this month's goal amounts aside.",
  noGoals: "No goals in progress.",
  monthsHeading: "Checking at the end of each month",
  monthsNote: "Before and after the change.",
  noChecking:
    "Link a checking account to see safe to spend and your checking balance over the next 12 months.",
  errors: {
    amount: "Enter an amount, like 250.",
    tooBig: `Enter an amount up to ${formatCents(MAX_AFFORD_CENTS)}.`,
    date: "Pick a date in the next 12 months.",
    month: "Pick a month in the next 12 months.",
  },
} as const;

// "Safe to spend until Oct 31: $1,200.00 → $950.00"
export function safeLine(until: string | null, before: string, after: string): string {
  return `${until ? `Safe to spend until ${until}` : "Safe to spend"}: ${before} → ${after}`;
}

// "Trip to Japan: $100.00 a month → $120.00 a month to reach it by Oct 19, 2027."
export function monthlyNeededLine(name: string, before: string, after: string, by: string) {
  return `${name}: ${before} a month → ${after} a month to reach it by ${by}.`;
}

// "Trip to Japan, at $100.00 → $50.00 a month: reached by Oct 2027 → by Apr 2028."
export function reachedByLine(
  name: string,
  pace: { before: string; after: string },
  before: string | null,
  after: string | null,
): string {
  const when = (month: string | null) =>
    month ? `by ${month}` : `not within ${MAX_GOAL_MONTHS / 12} years`;
  return `${name}, at ${pace.before} → ${pace.after} a month: reached ${when(before)} → ${when(after)}.`;
}

// "Checking goes below zero in March 2027 before the change, and in January 2027 after."
export function shortLine(before: string | null, after: string | null): string {
  if (!before && !after) return "Checking stays above zero every month, before and after.";
  if (!before) return `Checking goes below zero in ${after} after the change.`;
  if (!after) return `Checking goes below zero in ${before} before the change, and not after.`;
  return `Checking goes below zero in ${before} before the change, and in ${after} after.`;
}

// Every string, filled with sample values, for tests.
export function allAffordCopy(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(AFFORD_COPY);
  return [
    ...out,
    safeLine("Oct 31", "$1,200.00", "$950.00"),
    safeLine(null, "$1,200.00", "$950.00"),
    monthlyNeededLine("Trip to Japan", "$100.00", "$120.00", "Oct 19, 2027"),
    reachedByLine("Trip", { before: "$100.00", after: "$50.00" }, "Oct 2027", "Apr 2028"),
    reachedByLine("Trip", { before: "$100.00", after: "$0.00" }, "Oct 2027", null),
    shortLine(null, null),
    shortLine(null, "January 2027"),
    shortLine("March 2027", null),
    shortLine("March 2027", "January 2027"),
  ];
}
