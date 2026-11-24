// The changes Jane noticed (src/insights/changes.ts) that this report is the first to say. A change is
// chosen by whether an earlier report listed it (its key, remembered on that report's row), not by the
// date of the event: a charge the bank posts late is dated before the last report, but Jane noticed it
// after, so it is new. Pure.

export type NoticedChange = {
  // Stable per event (`bill:<stream>:<amount>`), so "That's expected" and this memory stick to it.
  key: string;
  title: string;
  merchant: string | null;
  confidencePercent: number;
};

export function newChanges(
  changes: readonly NoticedChange[],
  // Keys the last reports listed.
  seen: ReadonlySet<string>,
  // An alert that says the same thing (the same merchant) is the alert's to say.
  alerts: readonly { title: string }[],
  limit: number,
): NoticedChange[] {
  const alerted = alerts.map((a) => a.title.toLowerCase());
  return changes
    .filter(
      (c) =>
        !seen.has(c.key) &&
        !alerted.some((title) => c.merchant && title.includes(c.merchant.toLowerCase())),
    )
    .sort((a, b) => b.confidencePercent - a.confidencePercent || a.key.localeCompare(b.key))
    .slice(0, limit);
}
