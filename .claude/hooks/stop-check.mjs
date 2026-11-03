// Stop hook: before a session ends its turn, lint the code it changed, run the tests that import
// that code, and typecheck if that's fast. Exit 2 hands the failures back to the session, once
// (stop_hook_active stops a loop). Nothing changed since the last clean check costs a git status.
// The checks run the repo's own lint config, test config and tests, so they run only on a branch of
// this repo, with a short list of environment variables: no tokens, and no real database.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Seconds. The settings' hook timeout (200) must stay above the total.
const TOTAL_BUDGET = 170;
const LINT_BUDGET = 60;
const TEST_BUDGET = 60;
// `vitest related` follows imports all the way: one small rule file reached 832 test files and
// took 105s on 6 cores. So this runs the tests that import a changed file directly, and CI the rest.
const MAX_TEST_FILES = 40;
// A cold typecheck takes about 90s on this repo and a warm one about 10s, so a cold one is left
// running in the background for the next stop rather than waited for.
const WARM_TYPECHECK_NEEDS = 25;
const WARMING_FOR_MS = 5 * 60 * 1000;
const MAX_FAILURE_LINES = 40;

const CODE = /\.(ts|tsx|mts|mjs|js|jsx)$/;
const LOCAL_DB = /^postgres(ql)?:\/\/([^/@]*@)?(localhost|127\.0\.0\.1)(:\d+)?\//;
const PASSED_ON = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TZ",
  "LANG",
  "LC_ALL",
  "TERM",
];

function git(root, ...args) {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : "";
}

/** The files this branch changed from where it left main, committed or not. */
export function changedFiles(root) {
  const base = git(root, "merge-base", "HEAD", "origin/main").trim();
  const names = [
    ...(base ? git(root, "diff", "--name-only", "--diff-filter=ACMR", base).split("\n") : []),
    ...git(root, "diff", "--name-only", "--diff-filter=ACMR", "HEAD").split("\n"),
    ...git(root, "ls-files", "-o", "--exclude-standard").split("\n"),
  ];
  return [...new Set(names.filter(Boolean))];
}

export function codeFiles(files) {
  return files.filter((f) => CODE.test(f) && !f.startsWith("src/generated/"));
}

/** What a clean check is remembered by: the branch's commit and each changed file's bytes. */
export function fingerprint(root, files) {
  const hash = createHash("sha256");
  hash.update(git(root, "rev-parse", "HEAD"));
  for (const file of [...files].sort()) {
    hash.update(file);
    const path = join(root, file);
    if (existsSync(path) && statSync(path).isFile()) hash.update(readFileSync(path));
  }
  return hash.digest("hex");
}

/** The environment the checks run in: no tokens, and no way to reach a real database. */
export function safeEnv(env) {
  const out = {};
  for (const name of PASSED_ON) if (env[name] !== undefined) out[name] = env[name];
  if (LOCAL_DB.test(env.TEST_DATABASE_URL ?? "")) out.TEST_DATABASE_URL = env.TEST_DATABASE_URL;
  if (env.TEST_NO_BYPASS !== undefined) out.TEST_NO_BYPASS = env.TEST_NO_BYPASS;
  return out;
}

/**
 * Whether the checkout is this repo's own work, and so safe to run. `gh pr checkout` of someone
 * else's PR leaves a branch that follows their fork or refs/pull/*, and a detached HEAD could be
 * anything. A new branch that follows nothing yet is a session's own.
 */
export function isOwnBranch(root) {
  const branch = git(root, "symbolic-ref", "-q", "--short", "HEAD").trim();
  if (!branch) return false;
  const remote = git(root, "config", `branch.${branch}.remote`).trim();
  const merge = git(root, "config", `branch.${branch}.merge`).trim();
  return (remote === "" || remote === "origin") && !merge.startsWith("refs/pull/");
}

const running = new Set();

function killGroup(child) {
  try {
    // Negative: its whole process group. npx leaves the real work to a child of its own.
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // It has already gone.
  }
}

// If the session stops this hook, what it started goes too.
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    for (const child of running) killGroup(child);
    process.exit(0);
  });
}

/** Runs one check for at most `seconds`, whatever its children do with the output pipes. */
export function runCheck(root, args, seconds, env, command = "npx") {
  return new Promise((done) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    running.add(child);
    let output = "";
    let finished = false;
    const finish = (code, timedOut) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      running.delete(child);
      done({ code, output, timedOut });
    };
    const collect = (d) => {
      output += d;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      killGroup(child);
      child.stdout.destroy();
      child.stderr.destroy();
      finish(null, true);
    }, seconds * 1000);
    child.on("error", () => finish(1, false));
    child.on("close", (code) => finish(code, false));
  });
}

function tail(text) {
  const lines = text.trim().split("\n");
  return lines.slice(-MAX_FAILURE_LINES).join("\n");
}

const isTest = (file) => /\.test\.tsx?$/.test(file);
const needsDatabase = (file) => /\.integration\.test\./.test(file);

/** The changed tests, then the tests that import a changed file, nearest first. */
export function relatedTests(root, files, { withDatabase = false } = {}) {
  const changed = files.filter(isTest);
  const patterns = files
    .filter((f) => !isTest(f))
    .flatMap((f) => {
      const parts = f.split("/");
      const stem = basename(f).replace(/\.[^.]+$/, "");
      const name = stem === "index" ? (parts.at(-2) ?? stem) : stem;
      return ["-e", `/${name}"`, "-e", `/${basename(f)}"`];
    });
  const importers = patterns.length
    ? git(root, "grep", "-lF", "--untracked", ...patterns, "--", "*.test.ts", "*.test.tsx")
        .split("\n")
        .filter(Boolean)
    : [];
  const dirs = new Set(files.map(dirname));
  const near = (f) => (dirs.has(dirname(f)) ? 0 : 1);
  const others = importers.filter((f) => !changed.includes(f)).sort((a, b) => near(a) - near(b));
  return [...changed, ...others]
    .filter((f) => f.startsWith("src/") && (withDatabase || !needsDatabase(f)))
    .slice(0, MAX_TEST_FILES);
}

/** Runs the checks on `files`. Returns the failures and what couldn't be checked in time. */
export async function runChecks(root, files, { env = safeEnv(process.env), log = () => {} } = {}) {
  const started = Date.now();
  const left = () => TOTAL_BUDGET - (Date.now() - started) / 1000;
  const failures = [];
  const notChecked = [];

  const within = (seconds) => Math.max(Math.min(seconds, left()), 1);

  const lintable = files.filter((f) => !f.startsWith(".claude/") || f.endsWith(".mjs"));
  if (lintable.length) {
    const lint = await runCheck(root, ["eslint", "--quiet", ...lintable], within(LINT_BUDGET), env);
    log(`eslint ${Math.round((Date.now() - started) / 1000)}s`);
    if (lint.timedOut) notChecked.push("lint ran out of time");
    else if (lint.code !== 0)
      failures.push(`npx eslint ${lintable.join(" ")}\n${tail(lint.output)}`);
  }

  const format = await runCheck(root, ["prettier", "--check", ...files], within(LINT_BUDGET), env);
  if (format.timedOut) notChecked.push("formatting ran out of time");
  else if (format.code !== 0) {
    failures.push(`npx prettier --write ${files.join(" ")}\n${tail(format.output)}`);
  }

  const testFiles = relatedTests(root, files, { withDatabase: Boolean(env.TEST_DATABASE_URL) });
  if (testFiles.length) {
    const testsStarted = Date.now();
    const tests = await runCheck(
      root,
      ["vitest", "run", "--passWithNoTests", "--reporter=dot", ...testFiles],
      within(Math.min(TEST_BUDGET, Math.max(left() - WARM_TYPECHECK_NEEDS, 10))),
      env,
    );
    log(`${testFiles.length} test files ${Math.round((Date.now() - testsStarted) / 1000)}s`);
    if (tests.timedOut) notChecked.push("tests ran out of time (CI runs them all)");
    else if (tests.code !== 0) {
      failures.push(`npx vitest run ${testFiles.join(" ")}\n${tail(tests.output)}`);
    }
  }

  const buildInfo = resolve(
    root,
    git(root, "rev-parse", "--git-path", "stop-check/tsbuildinfo").trim(),
  );
  mkdirSync(dirname(buildInfo), { recursive: true });
  const tsc = ["tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", buildInfo];
  if (!existsSync(buildInfo)) {
    // One at a time: a session may stop again while the first is still running.
    const marker = `${buildInfo}.warming`;
    if (!existsSync(marker) || Date.now() - statSync(marker).mtimeMs > WARMING_FOR_MS) {
      writeFileSync(marker, "");
      const warmer = spawn("npx", tsc, { cwd: root, env, detached: true, stdio: "ignore" });
      warmer.unref();
    }
    notChecked.push("typecheck is warming up in the background, for the next stop");
  } else if (left() < WARM_TYPECHECK_NEEDS) {
    notChecked.push("typecheck skipped: no time left");
  } else {
    const typesStarted = Date.now();
    await runCheck(root, ["next", "typegen"], within(20), env);
    const types = await runCheck(root, tsc, within(left()), env);
    log(`typecheck ${Math.round((Date.now() - typesStarted) / 1000)}s`);
    if (types.timedOut) notChecked.push("typecheck ran out of time");
    else if (types.code !== 0) failures.push(`npx tsc --noEmit\n${tail(types.output)}`);
  }
  return { failures, notChecked, seconds: Math.round((Date.now() - started) / 1000) };
}

async function main() {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (input.stop_hook_active) return;
  const root = git(input.cwd ?? process.cwd(), "rev-parse", "--show-toplevel").trim();
  if (!root || !existsSync(join(root, "node_modules"))) return;
  if (!isOwnBranch(root)) {
    process.stdout.write("Stop check skipped: this checkout isn't a branch of this repo.\n");
    return;
  }
  const files = codeFiles(changedFiles(root)).filter((f) => existsSync(join(root, f)));
  if (!files.length) return;

  const stamp = resolve(root, git(root, "rev-parse", "--git-path", "stop-check/last-clean").trim());
  const print = fingerprint(root, files);
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === print) return;

  const { failures, notChecked, seconds } = await runChecks(root, files);
  if (failures.length) {
    process.stderr.write(
      `Stop check (${seconds}s) found problems in what this branch changed:\n\n` +
        `${failures.join("\n\n")}\n\nFix them, or say why they aren't this change's.\n`,
    );
    process.exit(2);
  }
  mkdirSync(dirname(stamp), { recursive: true });
  if (!notChecked.length) writeFileSync(stamp, print);
  else process.stdout.write(`Stop check (${seconds}s): ${notChecked.join("; ")}.\n`);
  // Anything a check left holding a pipe must not keep the hook open.
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    // A broken hook must never hold a session's turn open.
    process.stdout.write(`Stop check didn't run: ${e.message}\n`);
  });
}
