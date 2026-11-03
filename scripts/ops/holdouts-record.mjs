#!/usr/bin/env node
// Counts from a holdout run's Playwright report. Prints one flat record and no test names or error
// text, since the repository's logs and the ops-numbers branch are public.
import { readFileSync } from "node:fs";

export function countsOf(report) {
  const stats = report?.stats ?? {};
  const passed = stats.expected ?? 0;
  const failed = (stats.unexpected ?? 0) + (stats.flaky ?? 0);
  return { passed, total: passed + failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const sha = (process.env.GITHUB_SHA ?? "unknown").slice(0, 8);
  console.log(JSON.stringify({ at: new Date().toISOString(), sha, ...countsOf(report) }));
}
