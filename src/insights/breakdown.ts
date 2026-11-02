import type { CategoryTotal } from "./spending";

export type BreakdownRow = { label: string; cents: number; share?: number };

// A month's breakdown as the page lists it: each category with its share of what was spent
// (adding up to 100%), then the refunds that came to more than was bought, so the rows add up to
// the month's spending (debugger 11-02: a $250 refund left the shares at 119%).
export function breakdownRows(
  categories: readonly CategoryTotal[] = [],
  refunds: readonly CategoryTotal[] = [],
): BreakdownRow[] {
  const spent = categories.reduce((sum, c) => sum + c.cents, 0);
  return [
    ...categories.map((c) => ({
      label: c.category,
      cents: c.cents,
      ...(spent > 0 ? { share: c.cents / spent } : {}),
    })),
    ...refunds.map((r) => ({ label: `${r.category} refunds`, cents: r.cents })),
  ];
}
