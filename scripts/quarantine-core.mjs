// Which flaky end-to-end tests stop blocking, by a fixed rule and never by a session's judgement
// (docs/ci.md). A quarantined test keeps running and reporting, has an issue, and comes back by
// itself when its time is up. Pure.

export const QUARANTINE = {
  // It flaked on this many different main commits, so it isn't one bad commit.
  distinctMainCommits: 3,
  // A new test failing is far more likely to be a real problem (Slack's first try let real breaks
  // through by treating new tests as flaky).
  seenForDays: 7,
  expiresAfterDays: 14,
  mostAtOnce: 10,
};

// Never: a break in these is the thing the suite exists to catch.
const NEVER = [
  /@critical/,
  /access|cross-user|one person|another person/i,
  /guardrail|advice/i,
  /money|safe to spend|ledger|verified/i,
  /e2e\/(auth|sign-in|security|delete-account|privacy|legal)/,
];

const DAY = 24 * 60 * 60 * 1000;

const specOf = (id) => id.match(/e2e\/[\w./-]+\.spec\.ts/)?.[0] ?? null;
// "[chromium] e2e/a.spec.ts › the title": the title is what Playwright's filter sees.
const titleOf = (id) => id.split(" › ").slice(1).join(" ");

/**
 * @param records flake-list records, any order
 * @param current the list as it stands: [{ id, since, until }]
 * @returns the new list, oldest first
 */
export function quarantineList(records, current, now) {
  const today = Date.parse(now);
  const kept = current.filter((entry) => Date.parse(entry.until) > today);
  const stats = new Map();
  for (const record of records) {
    for (const test of record.tests ?? []) {
      if (test.kind !== "e2e") continue;
      const row = stats.get(test.id) ?? { firstSeen: record.at, commits: new Set() };
      if (record.at < row.firstSeen) row.firstSeen = record.at;
      const hidden = test.first === "failed" && test.last === "passed";
      if (hidden && record.branch === "main") row.commits.add(record.sha);
      stats.set(test.id, row);
    }
  }
  const list = [...kept];
  // Once a test's time is up it blocks again; only new failures can put it back.
  const lapsed = new Set(current.filter((entry) => !kept.includes(entry)).map((entry) => entry.id));
  const worst = [...stats.entries()].sort((a, b) => b[1].commits.size - a[1].commits.size);
  for (const [id, row] of worst) {
    if (list.length >= QUARANTINE.mostAtOnce) break;
    if (list.some((entry) => entry.id === id) || lapsed.has(id)) continue;
    if (row.commits.size < QUARANTINE.distinctMainCommits) continue;
    if (today - Date.parse(row.firstSeen) < QUARANTINE.seenForDays * DAY) continue;
    if (NEVER.some((rule) => rule.test(id))) continue;
    list.push({
      id,
      since: now,
      until: new Date(today + QUARANTINE.expiresAfterDays * DAY).toISOString(),
    });
  }
  return list;
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// What Playwright's --grep-invert gets. A test in a spec the PR changes isn't left out: this PR may
// be what's breaking it, and a failure on every retry there still blocks.
export function grepInvert(list, changedPaths = []) {
  const titles = list
    .filter((entry) => !changedPaths.includes(specOf(entry.id)))
    .map((entry) => titleOf(entry.id))
    .filter(Boolean);
  return [...new Set(titles)].map(escapeRegex).join("|");
}

export const issueBody = (entry) =>
  `\`${entry.id}\` flaked on several main commits, so it stops blocking until ${entry.until.slice(0, 10)}, under the rule in docs/ci.md. It still runs and reports. Fix it, or it blocks again on that date.`;
