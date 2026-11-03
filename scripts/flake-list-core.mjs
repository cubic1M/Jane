// The flake list (docs/ci.md). Playwright tries a test up to 3 times and CI re-runs a failed job once,
// so a test gets up to 6 attempts and a green run says nothing about how many it took. This reads
// each run's test reports and adds up what failed on its first try. Pure.

export const WINDOW_DAYS = 14;
export const KEEP_DAYS = 30;
const MAX_TESTS_IN_A_RECORD = 200;
const MAX_ID_LENGTH = 200;

const clip = (id) => id.replace(/\s+/g, " ").trim().slice(0, MAX_ID_LENGTH);

// Playwright's JSON report -> the tests whose first try went wrong, and how many it ran.
export function fromPlaywright(report) {
  const tests = [];
  let ran = 0;
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        if (results.length === 0 || test.status === "skipped") continue;
        ran += 1;
        const expected = test.expectedStatus ?? "passed";
        const first = results[0].status;
        if (first === expected) continue;
        const name = [...titles, spec.title].join(" › ");
        tests.push({
          id: clip(`[${test.projectName}] e2e/${spec.file} › ${name}`),
          kind: "e2e",
          first,
          last: results[results.length - 1].status === expected ? "passed" : "failed",
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
  };
  // The top level is one suite per file, titled with the file's name.
  for (const file of report.suites ?? []) walk(file, []);
  return { ran, tests };
}

// Vitest's JSON report. No retries, so a failure's first try is also its last. A file that fails
// before any test runs has no tests of its own, so the file stands in.
export function fromVitest(report) {
  const tests = [];
  let ran = 0;
  for (const file of report.testResults ?? []) {
    const path = String(file.name).replace(/^.*?(?=\bsrc\/)/, "");
    const assertions = file.assertionResults ?? [];
    if (assertions.length === 0 && file.status === "failed") {
      tests.push({ id: clip(path), kind: "unit", first: "failed", last: "failed" });
    }
    for (const test of assertions) {
      if (test.status === "pending" || test.status === "skipped" || test.status === "todo")
        continue;
      ran += 1;
      if (test.status !== "failed") continue;
      tests.push({
        id: clip(`${path} › ${test.fullName}`),
        kind: "unit",
        first: "failed",
        last: "failed",
      });
    }
  }
  return { ran, tests };
}

export function recordOf(run, reports) {
  const tests = reports.flatMap((r) => r.tests);
  return {
    ...run,
    ran: reports.reduce((sum, r) => sum + r.ran, 0),
    tests: tests.slice(0, MAX_TESTS_IN_A_RECORD),
  };
}

const onMain = (record) => record.branch === "main";
const PHONE_WORKFLOW = "E2E on a phone";
const isPhoneRun = (record) => record.workflow === PHONE_WORKFLOW;

// Each run's tests across its attempts. A test failed its first try if its first report says so,
// and came good if a retry passed or a later attempt ran and no longer lists it.
function runsOf(records) {
  const byRun = new Map();
  for (const record of records) {
    if (!byRun.has(record.run)) byRun.set(record.run, []);
    byRun.get(record.run).push(record);
  }
  return [...byRun.values()].map((attempts) => {
    const sorted = attempts.sort((a, b) => a.attempt - b.attempt);
    const tests = new Map();
    sorted.forEach((attempt, index) => {
      for (const test of attempt.tests) {
        const seen = tests.get(test.id);
        tests.set(test.id, { ...test, firstAttempt: seen?.firstAttempt ?? index, lastSeen: index });
      }
    });
    // An attempt with no reports (from before they existed, or expired) says nothing either way.
    const lastWithReports = sorted.findLastIndex((attempt) => attempt.ran > 0);
    for (const test of tests.values()) {
      if (test.lastSeen < lastWithReports) test.last = "passed";
    }
    return { first: sorted[0], latest: sorted[sorted.length - 1], tests: [...tests.values()] };
  });
}

export function flakeList(records, now, days = WINDOW_DAYS) {
  const since = new Date(now).getTime() - days * 24 * 60 * 60 * 1000;
  const runs = runsOf(records).filter((r) => new Date(r.first.at).getTime() >= since);
  const clean = (r) => r.first.tests.length === 0 && (r.first.jobsFailed ?? []).length === 0;
  const totals = (list) => {
    // A run with no reports can't be called clean: nothing says what its tests did.
    const known = list.filter((r) => r.first.ran > 0);
    return { runs: known.length, cleanFirstTry: known.filter(clean).length };
  };

  const rows = new Map();
  for (const run of runs) {
    for (const test of run.tests) {
      const row = rows.get(test.id) ?? {
        id: test.id,
        kind: test.kind,
        hidden: 0,
        stayedRed: 0,
        onMain: 0,
        lastAt: "",
        lastRun: run.first.run,
      };
      if (test.last === "passed") row.hidden += 1;
      else row.stayedRed += 1;
      if (onMain(run.first)) row.onMain += 1;
      if (run.first.at >= row.lastAt) {
        row.lastAt = run.first.at;
        row.lastRun = run.first.run;
      }
      rows.set(test.id, row);
    }
  }
  const byCount = (a, b) =>
    b.hidden + b.onMain - (a.hidden + a.onMain) || b.lastAt.localeCompare(a.lastAt);
  const all = [...rows.values()];
  // A test that failed every try on a PR's run is usually that PR's own doing.
  const flaky = all.filter((row) => row.hidden > 0 || row.onMain > 0).sort(byCount);

  const jobs = new Map();
  for (const run of runs) {
    for (const name of run.first.jobsFailed ?? []) {
      const job = jobs.get(name) ?? { name, main: 0, pr: 0 };
      if (onMain(run.first)) job.main += 1;
      else job.pr += 1;
      jobs.set(name, job);
    }
  }

  const phoneRuns = runs
    .filter((r) => isPhoneRun(r.first))
    .sort((a, b) => a.first.at.localeCompare(b.first.at));
  const lastPhone = phoneRuns[phoneRuns.length - 1]?.latest ?? null;

  return {
    since: new Date(since).toISOString().slice(0, 10),
    lastPhone,
    main: totals(runs.filter((r) => onMain(r.first) && !isPhoneRun(r.first))),
    pr: totals(runs.filter((r) => !onMain(r.first))),
    phone: totals(runs.filter((r) => isPhoneRun(r.first))),
    hiddenFailures: all.reduce((sum, row) => sum + row.hidden, 0),
    flaky,
    jobs: [...jobs.values()].sort((a, b) => b.main + b.pr - (a.main + a.pr)),
  };
}

const percent = ({ runs, cleanFirstTry }) =>
  runs === 0
    ? "no runs"
    : `${cleanFirstTry} of ${runs} (${Math.round((cleanFirstTry / runs) * 100)}%)`;
const cell = (text) => text.replaceAll("|", "\\|").replaceAll("<", "&lt;");

export function renderFlakes(list, repo, now) {
  const runLink = (row) =>
    `[${row.lastAt.slice(0, 10)}](https://github.com/${repo}/actions/runs/${row.lastRun})`;
  const lines = [
    "# Flake list",
    "",
    ...(list.lastPhone && list.lastPhone.conclusion !== "success"
      ? [
          `**The nightly phone run failed on ${list.lastPhone.at.slice(0, 10)}: ` +
            `https://github.com/${repo}/actions/runs/${list.lastPhone.run}. CI on main doesn't run the ` +
            "phone project, so nothing else will catch this. The debugger owns it.**",
          "",
        ]
      : []),
    `Updated ${String(now).slice(0, 16)}Z after each CI run, for the runs since ${list.since}. ` +
      "A first-try failure is one a Playwright retry or a job re-run may have hidden.",
    "",
    `- Main runs clean on the first try: ${percent(list.main)}`,
    `- PR runs clean on the first try: ${percent(list.pr)}`,
    `- Nightly phone runs clean on the first try: ${percent(list.phone)}`,
    `- First-try failures a retry or re-run hid: ${list.hiddenFailures}`,
    "",
    "## Tests",
    "",
  ];
  if (list.flaky.length === 0) lines.push("None.", "");
  else {
    lines.push(
      "| Test | Passed later | Failed every try | On main | Last |",
      "| --- | --- | --- | --- | --- |",
      ...list.flaky.map(
        (row) =>
          `| ${cell(row.id)} | ${row.hidden} | ${row.stayedRed} | ${row.onMain} | ${runLink(row)} |`,
      ),
      "",
    );
  }
  lines.push("## Jobs that failed on the first try", "");
  if (list.jobs.length === 0) lines.push("None.", "");
  else {
    lines.push(
      "| Job | Main | PRs |",
      "| --- | --- | --- |",
      ...list.jobs.map((job) => `| ${cell(job.name)} | ${job.main} | ${job.pr} |`),
      "",
    );
  }
  return lines.join("\n");
}

export const parseRecords = (text) =>
  text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

export function keepRecent(records, now) {
  const since = new Date(now).getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  return records.filter((r) => new Date(r.at).getTime() >= since);
}
