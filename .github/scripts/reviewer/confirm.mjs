#!/usr/bin/env node
// Runs reviewers' tests, which are the one thing a model writes that ever runs. This is run by
// review-confirm.yml on the PR's branch: it holds no secret and no write token, and its cache is the
// branch's own, so neither a model's test nor the PR's code can reach main's cache or a key.
//
//   node confirm.mjs --findings <dir> --base <sha> --head <sha> --out results.json
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseNameStatus, proofPlan, readVitestReport } from "../gates/core.mjs";
import { confirmOutcome, MAX_TESTS } from "./core.mjs";

const { values: args } = parseArgs({
  options: {
    findings: { type: "string" },
    base: { type: "string" },
    head: { type: "string" },
    out: { type: "string" },
  },
});

const git = (...a) =>
  execFileSync("git", ["--literal-pathspecs", ...a], { encoding: "utf8", stdio: "pipe" });

function vitest(file) {
  const dir = mkdtempSync(join(tmpdir(), "confirm-"));
  const out = join(dir, "report.json");
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CI: "1" };
  spawnSync(
    "npx",
    ["vitest", "run", "--no-file-parallelism", "--reporter=json", `--outputFile=${out}`, file],
    { env, stdio: "ignore", timeout: 180_000 },
  );
  try {
    return readVitestReport(JSON.parse(readFileSync(out, "utf8")));
  } catch {
    return { failed: [], missing: [], passed: 0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function toBase(source) {
  const fromBase = source.filter((c) => c.status !== "A").map((c) => c.file);
  if (fromBase.length) git("checkout", args.base, "--", ...fromBase);
  for (const c of source) if (c.status === "A") rmSync(c.file, { force: true });
}

function toHead(source) {
  const files = source.filter((c) => c.status !== "D").map((c) => c.file);
  if (files.length) git("checkout", args.head, "--", ...files);
  for (const c of source) if (c.status === "D") rmSync(c.file, { force: true });
  git("reset", "-q");
}

function main() {
  const changes = parseNameStatus(
    git("diff", "-z", "--name-status", "--no-renames", args.base, args.head),
  );
  const { source } = proofPlan(changes);
  const findings = readdirSync(args.findings)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => JSON.parse(readFileSync(join(args.findings, name), "utf8")).findings ?? []);
  const withTests = findings.filter((f) => f.test).slice(0, MAX_TESTS);
  const results = [];
  for (const [index, finding] of withTests.entries()) {
    // Our name, never the model's: its test can't land on an existing file.
    const file = `src/review-confirm-${index}.test.ts`;
    writeFileSync(file, finding.test);
    const onPr = vitest(file);
    toBase(source);
    const onBase = vitest(file);
    toHead(source);
    rmSync(file, { force: true });
    const outcome = confirmOutcome({ onPr, onBase });
    results.push({ family: finding.family, file: finding.file, line: finding.line, outcome });
    console.log(`Finding ${index}: ${outcome}`);
  }
  writeFileSync(args.out, JSON.stringify({ results }));
}

main();
