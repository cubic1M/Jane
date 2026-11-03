// Stop hook: before a session ends its turn, lint the code it changed, run the tests that reach
// that code, and typecheck if that's fast. Exit 2 hands the failures back to the session, once
// (stop_hook_active stops a loop). Nothing changed since the last clean check costs a git status.
// It holds no real database: DATABASE_URL is dropped, and TEST_DATABASE_URL kept only for localhost.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Seconds. The settings' hook timeout (200) must stay above the total.
const TOTAL_BUDGET = 170;
const LINT_BUDGET = 60;
// A cold typecheck takes about 90s on this repo and a warm one about 10s, so a cold one is left
// running in the background for the next stop rather than waited for.
const WARM_TYPECHECK_NEEDS = 25;
const MAX_FAILURE_LINES = 40;

const CODE = /\.(ts|tsx|mts|mjs|js|jsx)$/;
const LOCAL_DB = /^postgres(ql)?:\/\/[^/]*@?(localhost|127\.0\.0\.1)(:\d+)?\//;

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

/** The environment the checks run in: no way to reach a real database. */
export function safeEnv(env) {
  const out = { ...env };
  delete out.DATABASE_URL;
  delete out.DIRECT_URL;
  if (!LOCAL_DB.test(out.TEST_DATABASE_URL ?? "")) delete out.TEST_DATABASE_URL;
  return out;
}

function runCheck(root, args, seconds, env) {
  return new Promise((done) => {
    const child = spawn("npx", args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    const collect = (d) => {
      output += d;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, seconds * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, output, timedOut });
    });
  });
}

function tail(text) {
  const lines = text.trim().split("\n");
  return lines.slice(-MAX_FAILURE_LINES).join("\n");
}

/** Runs the checks on `files`. Returns the failures and what couldn't be checked in time. */
export async function runChecks(root, files, { env = safeEnv(process.env), log = () => {} } = {}) {
  const started = Date.now();
  const left = () => TOTAL_BUDGET - (Date.now() - started) / 1000;
  const failures = [];
  const notChecked = [];

  const lintable = files.filter((f) => !f.startsWith(".claude/") || f.endsWith(".mjs"));
  if (lintable.length) {
    const lint = await runCheck(root, ["eslint", "--quiet", ...lintable], LINT_BUDGET, env);
    log(`eslint ${Math.round((Date.now() - started) / 1000)}s`);
    if (lint.timedOut) notChecked.push("lint ran out of time");
    else if (lint.code !== 0)
      failures.push(`npx eslint ${lintable.join(" ")}\n${tail(lint.output)}`);
  }

  const testsStarted = Date.now();
  const tests = await runCheck(
    root,
    ["vitest", "related", "--run", "--passWithNoTests", "--reporter=dot", ...files],
    Math.max(left() - WARM_TYPECHECK_NEEDS, 10),
    env,
  );
  log(`related tests ${Math.round((Date.now() - testsStarted) / 1000)}s`);
  if (tests.timedOut) notChecked.push("related tests ran out of time (CI runs them all)");
  else if (tests.code !== 0) {
    failures.push(`npx vitest related --run ${files.join(" ")}\n${tail(tests.output)}`);
  }

  const buildInfo = resolve(
    root,
    git(root, "rev-parse", "--git-path", "stop-check/tsbuildinfo").trim(),
  );
  mkdirSync(dirname(buildInfo), { recursive: true });
  const tsc = ["tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", buildInfo];
  if (!existsSync(buildInfo)) {
    const warmer = spawn("npx", tsc, { cwd: root, env, detached: true, stdio: "ignore" });
    warmer.unref();
    notChecked.push("typecheck is warming up in the background, for the next stop");
  } else if (left() < WARM_TYPECHECK_NEEDS) {
    notChecked.push("typecheck skipped: no time left");
  } else {
    const typesStarted = Date.now();
    await runCheck(root, ["next", "typegen"], 20, env);
    const types = await runCheck(root, tsc, left(), env);
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
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    // A broken hook must never hold a session's turn open.
    process.stdout.write(`Stop check didn't run: ${e.message}\n`);
  });
}
