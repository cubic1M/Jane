import { LIFE_MIN_TERM_YEARS, LIFE_NEED, LIFE_TERMS } from "@/config/insurance";
import { formatCents } from "@/lib/money";

// How much life cover the person needs, and for how long (spec step 153), with the method
// shown line by line so every figure can be checked. Demo advice only. Pure.

export type LifeNeedInput = {
  yearlyPayCents: number | null;
  // People who depend on the person's income.
  dependants: number;
  mortgageCents: number;
  // Other loans and card balances.
  otherDebtCents: number;
  mortgageYearsLeft: number | null;
  savingsCents: number;
  // Life cover already in place: policies and cover through work.
  existingCoverCents: number;
};

export type NeedLine = { label: string; cents: number; adds: boolean };

export type LifeNeed = {
  amountCents: number;
  termYears: number;
  lines: NeedLine[];
  termWhy: string;
};

// Pure: null when no one depends on the person's income (then life cover isn't needed),
// or when their pay isn't known.
export function lifeNeed(input: LifeNeedInput): LifeNeed | null {
  if (input.dependants <= 0 || !input.yearlyPayCents) return null;
  const lines: NeedLine[] = [
    {
      label: `${LIFE_NEED.incomeYears} years of your pay`,
      cents: input.yearlyPayCents * LIFE_NEED.incomeYears,
      adds: true,
    },
  ];
  if (input.mortgageCents > 0) {
    lines.push({ label: "Paying off the mortgage", cents: input.mortgageCents, adds: true });
  }
  if (input.otherDebtCents > 0) {
    lines.push({ label: "Paying off other debts", cents: input.otherDebtCents, adds: true });
  }
  lines.push({ label: "Final expenses", cents: LIFE_NEED.finalExpensesCents, adds: true });
  lines.push({
    label: `School for ${input.dependants === 1 ? "1 dependant" : `${input.dependants} dependants`}`,
    cents: LIFE_NEED.educationPerDependantCents * input.dependants,
    adds: true,
  });
  if (input.savingsCents > 0) {
    lines.push({ label: "Less your savings", cents: input.savingsCents, adds: false });
  }
  if (input.existingCoverCents > 0) {
    lines.push({
      label: "Less life cover you already have",
      cents: input.existingCoverCents,
      adds: false,
    });
  }
  const raw = lines.reduce((sum, l) => sum + (l.adds ? l.cents : -l.cents), 0);
  const rounded = Math.ceil(raw / LIFE_NEED.roundToCents) * LIFE_NEED.roundToCents;
  if (rounded < LIFE_NEED.minCents) {
    // Savings and cover already in place are enough, or nearly.
    return raw <= 0 ? null : { amountCents: LIFE_NEED.minCents, ...term(input), lines };
  }
  return {
    amountCents: Math.min(rounded, LIFE_NEED.maxCents),
    ...term(input),
    lines,
  };
}

function term(input: LifeNeedInput): { termYears: number; termWhy: string } {
  const needed = Math.max(LIFE_MIN_TERM_YEARS, input.mortgageYearsLeft ?? 0);
  const termYears = LIFE_TERMS.find((t) => t >= needed) ?? LIFE_TERMS[LIFE_TERMS.length - 1];
  const termWhy =
    input.mortgageYearsLeft && input.mortgageYearsLeft > LIFE_MIN_TERM_YEARS
      ? `${termYears} years, so it lasts until the mortgage is paid off`
      : `${termYears} years, while the people who depend on you grow up`;
  return { termYears, termWhy };
}

// Pure: the method as lines: "+ $850,000.00 for 10 years of your pay".
export function methodLines(need: LifeNeed): string[] {
  return [
    ...need.lines.map((l) => `${l.adds ? "+" : "−"} ${formatCents(l.cents)}: ${l.label}`),
    `= ${formatCents(need.amountCents)}, rounded up, for ${need.termWhy}`,
  ];
}
