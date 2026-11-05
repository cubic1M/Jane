// The rules behind the pull request gates, as pure functions (src/gates/core.test.ts). CI runs
// them from the base branch's copy, so a pull request can't change the rules it is judged by.

/** The accuracy baselines, which may only get better. */
export const BASELINE_FILES = ["src/accuracy/baseline.json", "src/accuracy/csv/baseline.json"];

// In these a smaller number is better. Every other metric in the baselines is a share to raise;
// src/gates/core.test.ts fails on a metric in the real files that this can't place.
const SMALLER_IS_BETTER = new Set([
  "extraRows",
  "falseDoubleCharges",
  "dollarError",
  "spendingError",
  "incomeError",
  "lineErrorWhereKnown",
  "rentAskedNotRent",
  "silentNetWorth",
  "skippedIdleCashFalse",
]);
const LARGER_IS_BETTER =
  /(^|\.)(precision|recall)$|^(categoryRight|rowsReadExactly|lineCoverage|netWorthRight|typedNetWorthRight|typedIdleCashRight|answeredIdleCashRight)$/;

// Floats written back by the same run can differ past this; anything bigger is a real change.
const FLOAT_NOISE = 1e-9;

export function metricDirection(name) {
  if (SMALLER_IS_BETTER.has(name)) return "down";
  if (LARGER_IS_BETTER.test(name)) return "up";
  return "unknown";
}

function flatten(value, path, out) {
  for (const [key, inner] of Object.entries(value)) {
    const here = path ? `${path} / ${key}` : key;
    if (inner !== null && typeof inner === "object") flatten(inner, here, out);
    else out[here] = inner;
  }
  return out;
}

/** Each score that got worse or disappeared between two copies of a baseline file. */
export function baselineDrops(before, after) {
  const was = flatten(before, "", {});
  const now = after === null ? {} : flatten(after, "", {});
  const drops = [];
  for (const [path, old] of Object.entries(was)) {
    if (!(path in now)) {
      drops.push({ path, was: old, now: null });
      continue;
    }
    if (typeof old !== "number") continue;
    if (typeof now[path] !== "number") {
      drops.push({ path, was: old, now: now[path] });
      continue;
    }
    const name = path.split(" / ").pop();
    const change = now[path] - old;
    const worse = metricDirection(name) === "down" ? change > FLOAT_NOISE : change < -FLOAT_NOISE;
    if (worse) drops.push({ path, was: old, now: now[path] });
  }
  return drops;
}

/** `git diff -z --name-status`: NUL-separated, so no file name comes back quoted or escaped. */
export function parseNameStatus(output) {
  const parts = output.split("\0").filter((p) => p !== "");
  const changes = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i][0];
    if (status === "R" || status === "C") {
      changes.push({ status, from: parts[i + 1], file: parts[i + 2] });
      i += 3;
    } else {
      changes.push({ status, file: parts[i + 1] });
      i += 2;
    }
  }
  return changes;
}

// Matched in lower case: a Mac's disk finds .CLAUDE/settings.json at .claude/settings.json. A file
// named just `.claude` counts too, since a symlink there would replace the whole folder.
const PROTECTED_PATHS = [
  /(^|\/)\.claude(\/|$)/,
  /(^|\/)\.mcp\.json$/,
  /^\.github\/workflows$/,
  /^\.github\/workflows\/(ci|gates|merge-train|rerun-flaky|review|review-confirm|review-drill)\.ya?ml$/,
  /^\.github\/scripts(\/|$)/,
  /^src\/config\/advice\.ts$/,
  // With no person reading the flag, this file returning true is how a real account gets advice.
  /^src\/lib\/advice-mode\.ts$/,
  /^src\/accuracy\/accuracy\.test\.ts$/,
  /^src\/accuracy\/csv\/csv-accuracy\.test\.ts$/,
  /^vitest\.([^/]*\.)?(config|workspace)\./,
  /^src\/test-setup(\/|$)/,
  // A PR's own copy decides how many tests run, or whether its migrations are safe.
  /^scripts\/test-scope(-core)?\.mjs$/,
  /^scripts\/check-migrations\.mjs$/,
  /^scripts\/migration-gate-core\.mjs$/,
  /^scripts\/check-ratchets\.mjs$/,
];

// These change often enough, or matter little enough on their own, that blocking would hold up other
// work while no founder can approve. A change to one is flagged instead.
const WATCHED_PATHS = [
  /^\.github(\/|$)/,
  /^src\/lib\/guardrails\.ts$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /^\.gitleaks\.toml$/,
  /(^|\/)(claude|agents)\.md$/,
  /^\.semgrep(\/|$)/,
  /^\.dependency-cruiser\./,
  /^knip\.json$/,
  /^eslint\.config\./,
  /^stryker\.config\./,
  /^scripts\/rls-protect\.mjs$/,
  /^src\/security(\/|$)/,
  /^src\/config\/access-map\.ts$/,
  /^src\/config\/deny-by-default\.ts$/,
  /^src\/lib\/system-db\.ts$/,
  /^src\/lib\/db-scoped\.ts$/,
  /^src\/lib\/rls[^/]*\.ts$/,
];

/** Paths whose changes need a founder: agents' own limits, and the tests and gates that hold them. */
export function isProtectedPath(file) {
  const path = file.toLowerCase();
  return PROTECTED_PATHS.some((rule) => rule.test(path));
}

/** Paths whose changes are worth a founder's look, without blocking the merge. */
export function isWatchedPath(file) {
  const path = file.toLowerCase();
  return !isProtectedPath(file) && WATCHED_PATHS.some((rule) => rule.test(path));
}

/**
 * Whether the suite was turned back to running with a bypass (src/config/deny-by-default.ts). Turning
 * it on needs nobody's approval, since no founder can approve yet; turning it off does.
 */
export function bypassTurnedBackOn(before, after) {
  const value = (text) => /SUITE_RUNS_WITHOUT_BYPASS\s*=\s*(true|false)\b/.exec(text ?? "")?.[1];
  return value(before) === "true" && value(after) !== "true";
}

/** Whether package.json's scripts differ: `npm test` could be made to run nothing. */
export function scriptsChanged(before, after) {
  const scripts = (text) => {
    try {
      return JSON.stringify(JSON.parse(text).scripts ?? {});
    } catch {
      return null;
    }
  };
  return before !== null && scripts(before) !== scripts(after ?? "");
}

/**
 * Whether a founder has approved this exact commit: their latest review is an approval of `headSha`,
 * and none of them has asked for changes. GitHub records which commit a review was of, and a push
 * doesn't carry it over, unlike a label, or a date a commit can claim for itself. A login in
 * FOUNDER_LOGINS that also opened the PR doesn't count: every session opens PRs under one shared login.
 */
export function founderApproval({ reviews, founders, author, headSha }) {
  const logins = new Set(founders.map((f) => f.toLowerCase()));
  if (logins.size === 0) {
    return { ok: false, why: "no founder can approve yet: the FOUNDER_LOGINS variable is empty" };
  }
  const opener = (author ?? "").toLowerCase();
  const latest = new Map();
  for (const review of reviews) {
    const login = (review.login ?? "").toLowerCase();
    if (!logins.has(login) || login === opener) continue;
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) {
      latest.set(login, review);
    }
  }
  const decided = [...latest.values()];
  const against = decided.find((r) => r.state === "CHANGES_REQUESTED");
  if (against) return { ok: false, why: `${against.login} asked for changes` };
  const approved = decided.find((r) => r.state === "APPROVED" && r.commit === headSha);
  if (approved) return { ok: true, why: `approved by ${approved.login} at ${headSha.slice(0, 8)}` };
  if (decided.some((r) => r.state === "APPROVED")) {
    return { ok: false, why: "a founder approved an older commit, not the PR's newest" };
  }
  return { ok: false, why: "no founder has approved this commit" };
}

/**
 * Whether a PR counts as a fix, and so must prove itself. Debugger branches (nd/) and fix/ branches
 * do by default; any PR can say so with a "Proof-of-fix:" line, and "Proof-of-fix: none, <reason>"
 * says it isn't one.
 */
export function fixMarking({ title, body, branch, labels }) {
  const line = /^\s*proof-of-fix:\s*(.*)$/im.exec(body ?? "");
  if (line && /^none\b/i.test(line[1])) {
    return { isFix: false, why: `the PR says it isn't a fix: ${line[1].trim()}` };
  }
  if (line) return { isFix: true, why: "a Proof-of-fix line" };
  if (labels.includes("fix")) return { isFix: true, why: 'the "fix" label' };
  if (/^(nd|fix)\//.test(branch ?? "")) return { isFix: true, why: `the branch ${branch}` };
  if (/^fix(\(.*\))?:/i.test(title ?? "")) return { isFix: true, why: "the title" };
  return { isFix: false, why: "not marked as a fix" };
}

const isTestFile = (file) => /\.test\.tsx?$/.test(file);

// The access proof's tests run alone, in a job of their own (vitest.config.mts leaves them out).
const isAccessProof = (file) => /\.proof\.test\.tsx?$/.test(file);

/** A file the proof keeps at the PR's version: what the tests are, not what they test. */
function isTestSupport(file) {
  return (
    isTestFile(file) ||
    file.includes("/__fixtures__/") ||
    file.includes("/__snapshots__/") ||
    file.includes("/__mocks__/") ||
    file.startsWith("src/test-setup/") ||
    file.startsWith("src/generated/") ||
    BASELINE_FILES.includes(file)
  );
}

/**
 * What the proof of fix runs, from `git diff --name-status --no-renames`. `source` goes back to the
 * base commit; `tests` are run against it. The database schema, the lock file and everything outside
 * src/ and scripts/ stay as the PR has them, since the one install and migration serves both runs.
 */
export function proofPlan(changes) {
  const tests = changes
    .filter((c) => c.status !== "D" && c.file.startsWith("src/") && isTestFile(c.file))
    .filter((c) => !isAccessProof(c.file))
    .map((c) => c.file);
  const source = changes.filter(
    (c) =>
      (c.file.startsWith("src/") || c.file.startsWith("scripts/")) &&
      !isTestSupport(c.file) &&
      !c.file.endsWith(".md"),
  );
  return { tests: orderForProof(tests), source };
}

// Tests that need no database first, so most fixes never start one.
function orderForProof(tests) {
  const needsDb = (file) => /\.integration\.test\./.test(file);
  return [...tests.filter((t) => !needsDb(t)), ...tests.filter(needsDb)];
}

// Failing because the code isn't there says nothing about a bug: a new file can't load on the base
// commit, and a new function isn't a function there.
const MISSING_CODE =
  /Failed to (load|resolve)|Cannot find (module|package)|is not a function|is not a constructor|is not defined|Does the file exist/i;

/**
 * Reads Vitest's JSON report: `failed` is the tests that failed on what they assert, `missing` the
 * ones that failed only because code the PR adds isn't there yet (a whole file that can't load
 * counts here too).
 */
export function readVitestReport(report) {
  const failed = [];
  const missing = [];
  let passed = 0;
  for (const file of report.testResults ?? []) {
    if (file.status === "failed" && (file.assertionResults ?? []).length === 0) {
      missing.push({ test: file.name, message: file.message ?? "the file didn't load" });
    }
    for (const test of file.assertionResults ?? []) {
      if (test.status === "passed") passed += 1;
      if (test.status !== "failed") continue;
      const message = (test.failureMessages ?? []).join("\n");
      const entry = { test: test.fullName ?? test.title, message };
      (MISSING_CODE.test(message.split("\n")[0]) ? missing : failed).push(entry);
    }
  }
  return { failed, missing, passed };
}

const WEAK_MATCHERS = new Set([
  "toBeDefined",
  "toBeTruthy",
  "toBeFalsy",
  "not.toBeNull",
  "not.toBeUndefined",
  "not.toBe",
  "not.toEqual",
  "not.toThrow",
  "toHaveBeenCalled",
]);
const MIDDLE_MATCHERS = new Set([
  "toContain",
  "toContainEqual",
  "toMatch",
  "toMatchObject",
  "toBeGreaterThan",
  "toBeGreaterThanOrEqual",
  "toBeLessThan",
  "toBeLessThanOrEqual",
  "toBeCloseTo",
  "toContainText",
  "toHaveCount",
]);

function matcherStrength(matcher) {
  if (WEAK_MATCHERS.has(matcher)) return 0;
  if (MIDDLE_MATCHERS.has(matcher)) return 1;
  return 2;
}

// `expect(subject).not.toBe(x)` into its subject and matcher. A subject spread over lines reads as
// empty, which still pairs a line with one written the same way.
function parseExpect(line) {
  const start = line.search(/\bexpect(\.soft)?\(/);
  if (start < 0) return null;
  const open = line.indexOf("(", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < line.length; i += 1) {
    if (line[i] === "(") depth += 1;
    if (line[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return { subject: "", matcher: "", text: line.trim() };
  const rest = /^\s*\.\s*((?:not\s*\.\s*)?(?:resolves\s*\.\s*|rejects\s*\.\s*)?\w+)/.exec(
    line.slice(end + 1),
  );
  return {
    subject: line.slice(open + 1, end).trim(),
    matcher: rest ? rest[1].replace(/\s/g, "") : "",
    text: line.trim(),
  };
}

const LOOSE_ARGUMENT = /expect\.(anything|any)\(/;
const SKIPPED_TEST =
  /\b(?:it|test|describe)(?:\.\w+)*\.(?:skip|skipIf|todo|fails)\b|\bx(?:it|describe)\(/;

export const isTestPath = (file) => isTestFile(file) || /^e2e\/.*\.spec\.tsx?$/.test(file);

/**
 * From each test file's own diff, and the test files that went away: an `expect` line deleted with
 * nothing in its place, one replaced by a weaker check, or a test newly skipped. A line moved or
 * rewritten as just as strict a check isn't flagged, since that's most test edits (15 of the last
 * 120 merges touched an `expect` line this way).
 */
export function weakenedTests(fileDiffs, gone = []) {
  const flags = gone.map(({ file, kind }) => ({ file, kind, was: "", now: "" }));
  for (const { file, diff } of fileDiffs) {
    const removed = [];
    const added = [];
    // The header ends at the first hunk. After that a line starting "+++" is added text.
    const lines = diff.split("\n");
    for (const line of lines.slice(lines.findIndex((l) => l.startsWith("@@")) + 1)) {
      const sign = line[0];
      if (sign !== "+" && sign !== "-") continue;
      const body = line.slice(1);
      if (sign === "+" && SKIPPED_TEST.test(body)) {
        flags.push({ file, kind: "test skipped", was: "", now: body.trim() });
      }
      const parsed = parseExpect(body);
      if (parsed) (sign === "-" ? removed : added).push(parsed);
    }
    const unmatched = [...added];
    const take = (test) => {
      const at = unmatched.findIndex(test);
      return at < 0 ? null : unmatched.splice(at, 1)[0];
    };
    // Moved lines first, so a moved line can't be paired with some other line's rewrite.
    const rest = removed.filter((was) => !take((now) => now.text === was.text));
    for (const was of rest) {
      const now = take((n) => n.subject === was.subject);
      if (!now) {
        flags.push({ file, kind: "expect deleted", was: was.text, now: "" });
      } else if (
        matcherStrength(now.matcher) < matcherStrength(was.matcher) ||
        (LOOSE_ARGUMENT.test(now.text) && !LOOSE_ARGUMENT.test(was.text))
      ) {
        flags.push({ file, kind: "expect loosened", was: was.text, now: now.text });
      }
    }
  }
  return flags;
}

/** Test files gone from the run: deleted, or renamed to something that no longer runs. */
export function testFilesGone(changes) {
  const gone = [];
  for (const c of changes) {
    if (c.status === "D" && isTestPath(c.file)) gone.push({ file: c.file, kind: "file deleted" });
    if (c.status === "R" && isTestPath(c.from) && !isTestPath(c.file)) {
      gone.push({ file: c.file, kind: `renamed from ${c.from}, so it no longer runs` });
    }
  }
  return gone;
}
