// The rules behind the pull request gates, as pure functions (src/gates/core.test.ts). CI runs
// them from the base branch's copy, so a pull request can't change the rules it is judged by.

/** The label a founder puts on a PR that may break a gate. Agents never apply it. */
export const FOUNDER_LABEL = "founder-approved";

/** The accuracy baselines, which may only get better. */
export const BASELINE_FILES = ["src/accuracy/baseline.json", "src/accuracy/csv/baseline.json"];

/** The tests that hold code to those baselines; how far a score may slip may not grow. */
export const BASELINE_TESTS = [
  "src/accuracy/accuracy.test.ts",
  "src/accuracy/csv/csv-accuracy.test.ts",
];

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
    if (typeof old !== "number" || typeof now[path] !== "number") continue;
    const name = path.split(" / ").pop();
    const change = now[path] - old;
    const worse = metricDirection(name) === "down" ? change > FLOAT_NOISE : change < -FLOAT_NOISE;
    if (worse) drops.push({ path, was: old, now: now[path] });
  }
  return drops;
}

/** The value of `const ALLOWED_DROP = x` in a test file, or null when it has none. */
export function allowedDrop(text) {
  const found = /const\s+ALLOWED_DROP\s*=\s*([0-9.]+)/.exec(text ?? "");
  return found ? Number(found[1]) : null;
}

/** Paths whose changes need a founder: agents' own limits, and the gates that hold them. */
export function isProtectedPath(file) {
  return (
    file.startsWith(".claude/") ||
    file === ".mcp.json" ||
    file.startsWith(".github/workflows/") ||
    file.startsWith(".github/scripts/") ||
    file === "src/config/advice.ts"
  );
}

/**
 * Whether a founder's label counts. It must be on the PR, the latest time it went on must be by a
 * login in FOUNDER_LOGINS that isn't the PR's author (every session opens PRs under the one shared
 * login, so a label from that login could be an agent's), and no commit may be newer than it.
 */
export function founderApproval({ labels, labelEvents, founders, author, headCommitDate }) {
  if (!labels.includes(FOUNDER_LABEL)) {
    return { ok: false, why: `no "${FOUNDER_LABEL}" label` };
  }
  if (founders.length === 0) {
    return {
      ok: false,
      why: `"${FOUNDER_LABEL}" isn't honoured yet: the FOUNDER_LOGINS repository variable is empty`,
    };
  }
  const event = labelEvents.filter((e) => e.label === FOUNDER_LABEL).at(-1);
  if (!event) return { ok: false, why: `can't find who applied "${FOUNDER_LABEL}"` };
  if (!founders.includes(event.actor)) {
    return { ok: false, why: `"${FOUNDER_LABEL}" was applied by ${event.actor}, not a founder` };
  }
  if (event.actor === author) {
    return {
      ok: false,
      why: `"${FOUNDER_LABEL}" was applied by ${event.actor}, who also opened the PR`,
    };
  }
  if (Date.parse(event.at) < Date.parse(headCommitDate)) {
    return { ok: false, why: `"${FOUNDER_LABEL}" is older than the PR's newest commit` };
  }
  return { ok: true, why: `approved by ${event.actor}` };
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
 * From a unified diff of test files (and each file's status): an `expect` line deleted with nothing
 * in its place, one replaced by a weaker check, or a test newly skipped. A line moved or rewritten
 * as just as strict a check isn't flagged, since that's most test edits (15 of the last 120 merges
 * touched an `expect` line this way).
 */
export function weakenedTests(diff, deletedFiles = []) {
  const flags = deletedFiles
    .filter(isTestPath)
    .map((file) => ({ file, kind: "file deleted", was: "", now: "" }));
  const byFile = new Map();
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.slice(4).replace(/^b\//, "");
      if (file === "/dev/null") file = null;
      else if (!byFile.has(file)) byFile.set(file, { removed: [], added: [], skipped: [] });
      continue;
    }
    if (line.startsWith("--- ") || !file) continue;
    const entry = byFile.get(file);
    const sign = line[0];
    if (sign !== "+" && sign !== "-") continue;
    const body = line.slice(1);
    if (sign === "+" && SKIPPED_TEST.test(body)) entry.skipped.push(body.trim());
    const parsed = parseExpect(body);
    if (parsed) (sign === "-" ? entry.removed : entry.added).push(parsed);
  }
  for (const [name, { removed, added, skipped }] of byFile) {
    if (!isTestPath(name)) continue;
    for (const now of skipped) flags.push({ file: name, kind: "test skipped", was: "", now });
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
        flags.push({ file: name, kind: "expect deleted", was: was.text, now: "" });
      } else if (
        matcherStrength(now.matcher) < matcherStrength(was.matcher) ||
        (LOOSE_ARGUMENT.test(now.text) && !LOOSE_ARGUMENT.test(was.text))
      ) {
        flags.push({ file: name, kind: "expect loosened", was: was.text, now: now.text });
      }
    }
  }
  return flags;
}
