#!/usr/bin/env node
// One run of the daily canary (canary/README.md). Copies the task to an empty folder away from this
// repository, gives it to Claude Code headless, then scores it with tests the agent never saw.
//   node scripts/ops/canary.mjs            prints the record
//   node scripts/ops/canary.mjs --record   also adds it to the ops-numbers branch
// The agent gets no network tool and only that folder. Uses one fixed model, so a change shows.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canaryRecord } from "./canary-core.mjs";
import { writeData } from "./data-branch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANARY = join(HERE, "..", "..", "canary");
const MODEL = "claude-sonnet-5-5";
const MAX_TURNS = "20";
const LIMIT_MS = 10 * 60_000;

const folder = mkdtempSync(join(tmpdir(), "jane-canary-"));
cpSync(join(CANARY, "task"), folder, { recursive: true });
const prompt = readFileSync(join(CANARY, "prompt.txt"), "utf8");
const claude = process.env.CLAUDE_BIN ?? "claude";
const started = Date.now();
const run = spawnSync(
  claude,
  [
    "-p",
    prompt,
    "--model",
    MODEL,
    "--max-turns",
    MAX_TURNS,
    "--output-format",
    "json",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    "Read,Edit,Write,Bash(node --test*)",
    "--disallowedTools",
    "WebFetch,WebSearch",
  ],
  { cwd: folder, encoding: "utf8", timeout: LIMIT_MS, maxBuffer: 64 * 1024 * 1024 },
);
const seconds = (Date.now() - started) / 1000;

copyFileSync(join(CANARY, "hidden", "score.test.js"), join(folder, "score.test.js"));
const scored = spawnSync("node", ["--test", "score.test.js"], {
  cwd: folder,
  encoding: "utf8",
  timeout: 60_000,
});

let version = "unknown";
try {
  version = execFileSync(claude, ["--version"], { encoding: "utf8" }).trim().split(" ")[0];
} catch {
  // A missing version is a gap in the record, not a failed run.
}
const record = canaryRecord({
  output: run.stdout ?? "",
  solved: scored.status === 0,
  seconds,
  version,
  model: MODEL,
  at: new Date().toISOString(),
});
rmSync(folder, { recursive: true, force: true });
console.log(JSON.stringify(record));
if (process.argv.includes("--record")) {
  writeData(`Canary ${record.at.slice(0, 10)}`, (read) => ({
    "canary.jsonl": `${read("canary.jsonl")}${JSON.stringify(record)}\n`,
  }));
}
