#!/usr/bin/env node
// Prints the "Agent:" line a PR's body ends with: lane, model, Claude Code version and tokens spent
// on this branch, read from this session's own transcript. Numbers 10 and the version table on the
// numbers page come from it. Prints only those four values; a transcript's words stay put.
//   node scripts/ops/attribution.mjs            lane from the branch name
//   JANE_LANE=scanners node scripts/ops/attribution.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function newestTranscript(root = process.cwd()) {
  const dir = join(homedir(), ".claude", "projects", root.replace(/[^a-zA-Z0-9]/g, "-"));
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(dir, name))
    .toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

// Tokens from the branch's first commit on. Cache reads are left out: they say how long a session
// has run, more than what this piece cost.
export function readTranscript(text, since) {
  let model = "unknown";
  let version = "unknown";
  let tokens = 0;
  for (const line of text.split("\n")) {
    if (!line.includes('"assistant"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "assistant" || !entry.message?.usage) continue;
    model = entry.message.model ?? model;
    version = entry.version ?? version;
    if (entry.timestamp < since) continue;
    const { input_tokens, output_tokens, cache_creation_input_tokens } = entry.message.usage;
    tokens += (input_tokens ?? 0) + (output_tokens ?? 0) + (cache_creation_input_tokens ?? 0);
  }
  return { model, version, tokens };
}

export function laneOf(branch) {
  const name = branch.replace(/^(claude|nd|fix)\//, "");
  return name.split(/[/-]/)[0] || "unknown";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const firstCommit = git("log", "origin/main..HEAD", "--format=%aI").split("\n").at(-1);
  const since = firstCommit ? new Date(firstCommit).toISOString() : new Date().toISOString();
  const file = newestTranscript();
  const seen = file
    ? readTranscript(readFileSync(file, "utf8"), since)
    : { model: "unknown", version: "unknown", tokens: 0 };
  console.log(
    `Agent: lane=${process.env.JANE_LANE ?? laneOf(branch)} model=${seen.model} claude-code=${seen.version} tokens=${seen.tokens}`,
  );
}
