// Every sentence the debt planner shows. Kept in one place so a test can check none of
// it recommends a choice (src/lib/guardrails.ts recommendsAChoice).

export const PLANNER_COPY = {
  title: "What paying off your cards and loans could look like",
  intro:
    "Rates and minimum payments come from your bank when it reports them; fill in any that are missing, and what you could pay toward these debts each month. We show two common orders for paying them down, side by side.",
  fromBank: "Rate and minimum from your bank. Change them to try other numbers.",
  mortgageLeftOut: "Mortgages aren't included here.",
  disclaimer:
    "This is math, not a recommendation. It assumes no new purchases, fees or rate changes, and rounds interest to the cent each month. Your statements are the source of truth.",
  strategies: {
    avalanche: {
      name: "Highest rate first",
      also: "Sometimes called the avalanche method.",
      how: "After the minimums, extra money goes to the debt with the highest rate.",
    },
    snowball: {
      name: "Smallest balance first",
      also: "Sometimes called the snowball method.",
      how: "After the minimums, extra money goes to the debt with the smallest balance.",
    },
  },
  budgetBelowMinimums:
    "The monthly amount is less than the minimum payments added up. Raise it to at least the total of the minimums.",
  neverPaysOff:
    "At this monthly amount the balance doesn't go down fast enough to finish within 50 years. Try a higher monthly amount.",
  noCards:
    "We didn't find credit cards or loans on your linked accounts. Add one by hand to try the numbers.",
} as const;

// Every string in the copy, for tests.
export function allPlannerCopy(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(PLANNER_COPY);
  return out;
}
