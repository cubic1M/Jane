// A duplicate group ("you pay for 2 video streaming services") puts a saving on the cheaper
// of its services, and each service also has its own "review your X" item with its whole yearly
// cost. Counting both in a total counts the same dollars twice (spec step 263, from the QA
// sweep). Both stay on the plan, since the cancel flow works from the single review; the
// total counts the group's dollars only when the cheaper service (whose cost the saving is) has no
// review adding a saving of its own. A price
// rise on a service with its own review is the same: the review's yearly cost is at the new price,
// so cancelling saves the rise too (debugger 11-16: Hulu's $24 rise beside its $143.88 review).

type Row = { type: string; evidence: unknown };

const costOf = (evidence: unknown, merchant: string): number | null => {
  const services = (evidence as { services?: unknown } | null)?.services;
  if (!Array.isArray(services)) return null;
  const hit = services.find((s) => (s as { merchant?: unknown })?.merchant === merchant) as
    { annualCostCents?: unknown } | undefined;
  return typeof hit?.annualCostCents === "number" ? hit.annualCostCents : null;
};

const merchantsOf = (evidence: unknown): string[] => {
  const services = (evidence as { services?: unknown } | null)?.services;
  return Array.isArray(services)
    ? services.flatMap((s) =>
        typeof (s as { merchant?: unknown })?.merchant === "string"
          ? [(s as { merchant: string }).merchant]
          : [],
      )
    : [];
};

// The group and price-rise rows whose dollars are already in the single reviews beside them.
export function groupsCountedElsewhere<T extends Row>(rows: readonly T[]): Set<T> {
  const reviewed = new Set(
    rows
      // A review adds its dollars only with a saving: an unconfirmed guess (saving null) adds none,
      // so it covers neither a price rise nor a group beside it (CodeRabbit 1c).
      .filter(
        (r) =>
          r.type === "subscription_review" &&
          (r as { annualSavingsCents?: number | null }).annualSavingsCents !== null,
      )
      .map((r) => (r.evidence as { merchant?: unknown } | null)?.merchant)
      .filter((m): m is string => typeof m === "string"),
  );
  return new Set(
    rows.filter((r) => {
      if (r.type === "price_increase") {
        return reviewed.has((r.evidence as { merchant?: unknown } | null)?.merchant as string);
      }
      if (r.type !== "duplicate_subscription") return false;
      const members = merchantsOf(r.evidence);
      if (members.length > 0 && members.every((m) => reviewed.has(m))) return true;
      // The group's saving is the cheaper service's yearly cost, which that service's review
      // already carries: counted there even when the dearer service has no review.
      const costs = members.map((m) => costOf(r.evidence, m));
      if (costs.length === 0 || costs.some((c) => c === null)) return false;
      const cheapest = Math.min(...(costs as number[]));
      return members.some((m, i) => costs[i] === cheapest && reviewed.has(m));
    }),
  );
}

// The plan's yearly total: every row's saving, the group's left out where its dollars are
// already counted in the reviews of its services.
export function planTotal<T extends Row & { annualSavingsCents: number | null }>(
  rows: readonly T[],
): number {
  const skipped = groupsCountedElsewhere(rows);
  return rows.reduce((sum, r) => sum + (skipped.has(r) ? 0 : (r.annualSavingsCents ?? 0)), 0);
}
