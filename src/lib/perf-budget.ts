// The first-load JavaScript budget (founder, 2026-10-26: "make Jane fast on phones"). `next build`
// writes .next/diagnostics/route-bundle-stats.json with each route's uncompressed first-load JS;
// scripts/check-perf-budget.ts compares the main pages to src/config/perf-budget.json and CI
// fails the build when one grows past its number. Lower a number when a page gets lighter, so the
// gain can't quietly be lost; raise one only with a reason in the pull request.

export type RouteStat = { route: string; firstLoadUncompressedJsBytes: number };
export type Budget = Record<string, number>;

export type BudgetRow = {
  route: string;
  bytes: number | null;
  budget: number;
  ok: boolean;
};

// One row per budgeted route. A budgeted route missing from the build is a failure too: a
// renamed page must not silently drop out of the check.
export function checkBudget(stats: readonly RouteStat[], budget: Budget): BudgetRow[] {
  const bytesOf = new Map(stats.map((s) => [s.route, s.firstLoadUncompressedJsBytes]));
  return Object.entries(budget).map(([route, limit]) => {
    const bytes = bytesOf.get(route) ?? null;
    return { route, bytes, budget: limit, ok: bytes !== null && bytes <= limit };
  });
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`;

export function describeRow(row: BudgetRow): string {
  if (row.bytes === null) return `FAIL  ${row.route}: not in the build (budget ${kb(row.budget)})`;
  const mark = row.ok ? "PASS" : "FAIL";
  const over = row.ok ? "" : ` (${kb(row.bytes - row.budget)} over)`;
  return `${mark}  ${row.route}: ${kb(row.bytes)} of ${kb(row.budget)}${over}`;
}
