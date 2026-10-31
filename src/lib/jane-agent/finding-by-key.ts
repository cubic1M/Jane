// The open finding each charge points to, by its key. Two can share one (Netflix's price rise and
// its subscription review are both "merchant:netflix"); the more particular one wins over the
// general review, then the oldest, so it's the same every time (debugger 10-31: the database's
// order decided, and typing.integration failed one run in four).
export function findingByKey(
  findings: readonly { id: string; key: string; type: string; createdAt: Date }[],
): Map<string, string> {
  const rank = (f: { type: string }) => (f.type === "subscription_review" ? 1 : 0);
  const sorted = [...findings].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  const out = new Map<string, string>();
  for (const f of sorted) if (!out.has(f.key)) out.set(f.key, f.id);
  return out;
}
