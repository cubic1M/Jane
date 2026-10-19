import type { Bracket } from "@/config/tax-rates";

// Tax on income from a schedule of brackets (cents in, cents out).
export function bracketTax(incomeCents: number, brackets: readonly Bracket[]): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i += 1) {
    const from = brackets[i].over;
    const to = brackets[i + 1]?.over ?? Infinity;
    if (incomeCents <= from) break;
    tax += (Math.min(incomeCents, to) - from) * brackets[i].rate;
  }
  return Math.round(tax);
}
