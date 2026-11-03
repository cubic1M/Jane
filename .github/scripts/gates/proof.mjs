#!/usr/bin/env node
// Proof of fix: the PR's tests must fail against the base commit's source, then pass against the
// PR's. Run from the PR's checkout, whose source this changes and puts back.
//
//   node proof.mjs --base <sha> --head <sha>
//
// A database is started only for integration tests, and only when CI is running this: a local run
// needs TEST_DATABASE_URL on this machine, and refuses any other host. DATABASE_URL is never passed on.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseNameStatus, proofPlan, readVitestReport } from "./core.mjs";

const { values: args } = parseArgs({
  options: { base: { type: "string" }, head: { type: "string" } },
});

// How many test files one PR's proof runs: the first that proves the fix ends it, so this only
// bounds a PR whose tests all pass on the old code.
const MAX_TEST_FILES = 6;
const LOCAL_DB = /^postgres(ql)?:\/\/([^/@]*@)?(localhost|127\.0\.0\.1)(:\d+)?\//;
const CI_DB = "postgresql://postgres@localhost:5432/test";

// A file name is the PR's to choose, so never let git read one as a pattern.
const git = (...a) =>
  execFileSync("git", ["--literal-pathspecs", ...a], { encoding: "utf8", stdio: "pipe" });
const run = (cmd, ...a) => execFileSync(cmd, a, { stdio: "inherit" });

function say(lines) {
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${lines.join("\n")}\n`);
  }
}

function fail(lines) {
  say(["## Proof of fix: **FAIL**", ...lines]);
  if (process.env.GITHUB_ACTIONS) console.log(`::error::Proof of fix failed: ${lines[0]}`);
  process.exit(1);
}

function startDatabase() {
  if (process.env.GITHUB_ACTIONS) {
    // One run can judge two PRs, each with its own proof.
    spawnSync("docker", ["rm", "-f", "proof-db"]);
    run(
      "docker",
      ...["run", "-d", "--name", "proof-db", "-p", "5432:5432"],
      ...["-e", "POSTGRES_DB=test", "-e", "POSTGRES_HOST_AUTH_METHOD=trust"],
      ...["--tmpfs", "/var/lib/postgresql/data", "postgres:16"],
    );
    for (let i = 0; i < 60; i += 1) {
      const ready = spawnSync("docker", ["exec", "proof-db", "pg_isready", "-U", "postgres"]);
      if (ready.status === 0) break;
      execFileSync("sleep", ["1"]);
    }
    run("node", "scripts/fast-test-postgres.mjs", CI_DB);
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      stdio: "inherit",
      env: { ...process.env, DIRECT_URL: CI_DB },
    });
    run("node", "scripts/rls-protect.mjs", CI_DB);
    return CI_DB;
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !LOCAL_DB.test(url)) {
    fail(["An integration test needs TEST_DATABASE_URL on this machine (localhost only)."]);
  }
  return url;
}

let database = null;

function vitest(files) {
  if (files.some((f) => /\.integration\.test\./.test(f)) && database === null) {
    database = startDatabase();
  }
  const dir = mkdtempSync(join(tmpdir(), "proof-"));
  const out = join(dir, "report.json");
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DIRECT_URL;
  if (database) env.TEST_DATABASE_URL = database;
  else delete env.TEST_DATABASE_URL;
  const started = Date.now();
  spawnSync(
    "npx",
    ["vitest", "run", "--no-file-parallelism", "--reporter=json", `--outputFile=${out}`, ...files],
    { env, stdio: "ignore" },
  );
  const seconds = Math.round((Date.now() - started) / 1000);
  let report;
  try {
    report = readVitestReport(JSON.parse(readFileSync(out, "utf8")));
  } catch {
    fail([`Vitest wrote no report for ${files.join(", ")}.`]);
  }
  rmSync(dir, { recursive: true, force: true });
  return { ...report, seconds };
}

function toBase(source, base) {
  const fromBase = source.filter((c) => c.status !== "A").map((c) => c.file);
  const added = source.filter((c) => c.status === "A").map((c) => c.file);
  if (fromBase.length) git("checkout", base, "--", ...fromBase);
  for (const file of added) rmSync(file, { force: true });
}

function toHead(source, head) {
  const files = source.filter((c) => c.status !== "D").map((c) => c.file);
  if (files.length) git("checkout", head, "--", ...files);
  const deleted = source.filter((c) => c.status === "D").map((c) => c.file);
  for (const file of deleted) rmSync(file, { force: true });
  git("reset", "-q");
}

const firstLine = (text) => text.split("\n").find((l) => l.trim()) ?? "";

function main() {
  const { base, head } = args;
  const changes = parseNameStatus(git("diff", "-z", "--name-status", "--no-renames", base, head));
  const { tests, source } = proofPlan(changes);
  if (source.length === 0) {
    say(["## Proof of fix: nothing to prove", "The PR changes no source, only tests or docs."]);
    return;
  }
  if (tests.length === 0) {
    fail([
      "This fix changes source but adds or changes no unit test, so nothing can show it worked.",
      "Add a test under src/ that fails without the fix.",
      "If this PR isn't a fix, add a line to its body: `Proof-of-fix: none, <reason>`.",
    ]);
  }
  const candidates = tests.slice(0, MAX_TEST_FILES);
  const lines = [];
  let proved = null;
  let onlyMissing = [];
  toBase(source, base);
  try {
    for (const file of candidates) {
      const before = vitest([file]);
      lines.push(
        `- Base commit's source, ${file}: ${before.failed.length} failed on what they check, ` +
          `${before.missing.length} failed on code not there yet, ${before.passed} passed (${before.seconds}s)`,
      );
      onlyMissing.push(...before.missing);
      if (before.failed.length) {
        proved = { file, failed: before.failed };
        break;
      }
    }
  } finally {
    toHead(source, head);
  }
  if (!proved) {
    const why = onlyMissing.length
      ? [
          "The tests failed only because code the PR adds isn't on the base commit, which shows nothing about a bug. Test the behaviour through something that exists on both sides.",
          ...onlyMissing.slice(0, 3).map((m) => `  - ${m.test}: ${firstLine(m.message)}`),
        ]
      : ["Every test passed on the old code, so none of them shows the bug the fix is for."];
    fail([...why, ...lines, "If this PR isn't a fix, add `Proof-of-fix: none, <reason>`."]);
  }
  const after = vitest([proved.file]);
  lines.push(
    `- PR's source, ${proved.file}: ${after.failed.length + after.missing.length} failed, ` +
      `${after.passed} passed (${after.seconds}s)`,
  );
  if (after.failed.length + after.missing.length > 0 || after.passed === 0) {
    fail(["The test that failed before still doesn't pass with the fix.", ...lines]);
  }
  say([
    "## Proof of fix: pass",
    ...lines,
    `- It failed before the fix on: ${proved.failed[0].test}`,
  ]);
}

main();
