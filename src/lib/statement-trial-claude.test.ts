import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Anyone can make a temporary person with no sign-up, so nothing they can reach may spend the
// Anthropic budget except the chat, which is capped (src/lib/jane-agent/claude-limits.ts). Every
// file that calls Claude is listed here with where that's stopped for them: a new call fails this
// test until someone has worked out whether a visitor can reach it.

const GATED = {
  // The chat: capped per person and per day (claude-limits.ts, typing.ts, spend.ts).
  "src/lib/jane-agent/claude.ts": "src/lib/jane-agent/claude-limits.ts",
  // Sorting merchants, what's a subscription, card text, the weekly ideas, the monthly summary.
  "src/categorize/llm.ts": "src/categorize/categorize.ts",
  "src/lib/subscription-check.ts": "src/detection/engine.ts",
  "src/lib/explain.ts": "src/lib/explanations.ts",
  "src/lib/strategist.ts": "src/lib/strategist.ts",
  "src/lib/check-in.ts": "src/lib/check-in.ts",
  // Everything that reads an uploaded document: the upload action refuses them.
  "src/lib/documents/extract.ts": "src/app/documents/actions.ts",
  "src/lib/read-fields.ts": "src/app/documents/actions.ts",
} as const;

// Reached only through the agent, the team, or a cron with no person in it. A temporary person's
// Yes never starts the agent (conciergeMode, tested in statement-trial.integration.test.ts).
const NOT_REACHED = new Set([
  // What Claude paths are handed in place of the client: the gates above come before it.
  "src/lib/claude-budget.ts",
  "src/lib/drafts.ts",
  "src/lib/agent/read-reply.ts",
  "src/lib/agent/find-contact.ts",
  "src/lib/news/summarize.ts",
  "src/lib/jane-agent/checks/grader.ts",
  "src/lib/jane-agent/checks/run.ts",
  "src/lib/jane-agent/checks/proof.ts",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "generated" || name === "__fixtures__" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const CALLS_CLAUDE = /\.messages\s*\.(create|stream)\(/;

describe("what a temporary person can spend", () => {
  const callers = sourceFiles("src")
    .filter((file) => CALLS_CLAUDE.test(readFileSync(file, "utf8")))
    .sort();

  it("every call to Claude has been looked at", () => {
    const known = new Set([...Object.keys(GATED), ...NOT_REACHED]);
    expect(callers.filter((file) => !known.has(file))).toEqual([]);
  });

  it("every gate is still there", () => {
    for (const gate of new Set(Object.values(GATED))) {
      // isTrialUser (#1254) stops sample people and these alike; the id starts the same way.
      expect(readFileSync(gate, "utf8"), gate).toMatch(/isStatementTrialUser|isTrialUser/);
    }
  });

  it("the documents gate comes before anything is read", () => {
    const source = readFileSync("src/app/documents/actions.ts", "utf8");
    const gate = source.indexOf("isStatementTrialUser(user.id)");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(source.indexOf("file.arrayBuffer()"));
  });
});
