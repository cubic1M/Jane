// A duplicate group ("you pay for 2 video streaming services") puts a saving on the cheaper
// of its services, and each service also has its own "review your X" item with its whole yearly
// cost. Counting both in a total counts the same dollars twice (spec step 263, from the QA
// sweep). Both stay on the plan, since the cancel flow works from the single review; the
// total counts the group's dollars only when some service in it has no review of its own.

type Row = { type: string; evidence: unknown };

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

// The group rows whose dollars are already in the single reviews beside them.
export function groupsCountedElsewhere<T extends Row>(rows: readonly T[]): Set<T> {
  const reviewed = new Set(
    rows
      .filter((r) => r.type === "subscription_review")
      .map((r) => (r.evidence as { merchant?: unknown } | null)?.merchant)
      .filter((m): m is string => typeof m === "string"),
  );
  return new Set(
    rows.filter((r) => {
      if (r.type !== "duplicate_subscription") return false;
      const members = merchantsOf(r.evidence);
      return members.length > 0 && members.every((m) => reviewed.has(m));
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
