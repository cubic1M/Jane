import type { Bracket } from "@/config/tax-rates";

// Tax on income from a schedule of brackets, in cents but not yet rounded: a caller that adds or
// subtracts bracket taxes (a gains stack) sums these and rounds once, so one cent is not made or
// lost by rounding each piece.
export function bracketTaxExact(incomeCents: number, brackets: readonly Bracket[]): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i += 1) {
    const from = brackets[i].over;
    const to = brackets[i + 1]?.over ?? Infinity;
    if (incomeCents <= from) break;
    tax += (Math.min(incomeCents, to) - from) * brackets[i].rate;
  }
  return tax;
}

// Tax on income from a schedule of brackets (cents in, cents out).
export function bracketTax(incomeCents: number, brackets: readonly Bracket[]): number {
  return Math.round(bracketTaxExact(incomeCents, brackets));
}
