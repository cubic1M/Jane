#!/usr/bin/env node
// One review from one model family. The model has no tools, runs in an empty folder and gets the diff
// as text; this holds the model's own key and no GitHub token. A failure here is written down, not
// thrown, so the verdict can say which review didn't finish.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { FINDINGS_SCHEMA, parseFindings, reviewPrompt } from "./core.mjs";

const { values: args } = parseArgs({
  options: {
    family: { type: "string" },
    diff: { type: "string" },
    out: { type: "string" },
    timeout: { type: "string", default: "600" },
  },
});

const SECONDS = Number(args.timeout);

/** The fresh pass: Claude with every tool, setting, hook and MCP server off. */
function askClaude(prompt) {
  if (!process.env.REVIEWER_CLAUDE_MODEL) throw new Error("REVIEWER_CLAUDE_MODEL isn't set");
  const cli = [
    "--print",
    ...["--model", process.env.REVIEWER_CLAUDE_MODEL],
    ...["--output-format", "json"],
    ...["--json-schema", JSON.stringify(FINDINGS_SCHEMA)],
    ...["--tools", ""],
    ...["--setting-sources", ""],
    "--strict-mcp-config",
    "--no-session-persistence",
    ...["--system-prompt", prompt.system],
  ];
  const env = { PATH: process.env.PATH };
  for (const name of ["HOME", "USER", "CLAUDE_CODE_OAUTH_TOKEN"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  const result = spawnSync("claude", cli, {
    input: prompt.user,
    cwd: mkdtempSync(join(tmpdir(), "review-")),
    env,
    encoding: "utf8",
    timeout: SECONDS * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new Error(`claude didn't run: ${result.error.code ?? "error"}`);
  if (result.status !== 0) throw new Error(`claude exited ${result.status}`);
  const answer = JSON.parse(result.stdout);
  if (answer.is_error) throw new Error("claude reported an error");
  return answer.structured_output ?? answer.result;
}

/** The other family, by plain HTTP: no CLI to install, and no tools to turn off. */
async function askSecond(prompt) {
  const key = process.env.REVIEWER_SECOND_KEY;
  const model = process.env.REVIEWER_SECOND_MODEL;
  if (!key) throw new Error("no second family's key yet (founder step F3)");
  if (!model) throw new Error("REVIEWER_SECOND_MODEL isn't set");
  const base = process.env.REVIEWER_SECOND_URL ?? "https://generativelanguage.googleapis.com";
  const response = await fetch(
    `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(SECONDS * 1000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: "user", parts: [{ text: prompt.user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: FINDINGS_SCHEMA,
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`the second family answered ${response.status}`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
}

async function main() {
  const family = args.family;
  let result;
  try {
    const prompt = reviewPrompt(readFileSync(args.diff, "utf8"));
    const raw = family === "claude" ? askClaude(prompt) : await askSecond(prompt);
    const findings = parseFindings(raw).map((f) => ({ ...f, family }));
    result = { family, ok: true, findings };
  } catch (error) {
    // Our own message, or a parser's: never the model's text.
    const why = error instanceof SyntaxError ? "its answer wasn't JSON" : error.message;
    result = { family, ok: false, why, findings: [] };
  }
  writeFileSync(args.out, JSON.stringify(result));
  // Counts only: what a model wrote never reaches the log, where it could be a workflow command.
  console.log(`${family}: ${result.ok ? `${result.findings.length} findings` : "didn't finish"}`);
}

main();
