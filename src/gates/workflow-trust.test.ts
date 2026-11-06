import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript module, with no types.
import { isProtectedPath } from "../../.github/scripts/gates/core.mjs";

// Two rules for every workflow, read from the files themselves.
// 1. One that holds a secret beyond the run's own token, or a token that writes to the repo, is a
//    protected file: a change merged there runs with that secret on the next run of main, so an
//    agent's green PR can't be enough. Only a founder approves it (docs/gates.md).
// 2. Its jobs run on GitHub's own machines, never CI_RUNNER: a self-hosted runner keeps what a
//    branch's code leaves on it for the next job, and any branch can name any runner label.

const DIR = join(__dirname, "../../.github/workflows");
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const WRITES = /^\s*(contents|actions|pull-requests|packages|deployments|id-token):\s*write\b/m;
const SECRET = /secrets\.(?!GITHUB_TOKEN\b)[A-Z0-9_]+/;

describe("workflows that hold secrets or write to the repo", () => {
  const trusted = files.filter((f) => {
    const text = readFileSync(join(DIR, f), "utf8");
    return SECRET.test(text) || WRITES.test(text);
  });

  it("are found (the reading works)", () => {
    expect(trusted).toEqual(expect.arrayContaining(["deploy.yml", "watch.yml", "canary.yml"]));
  });

  it.each(trusted)("%s is a protected file", (file) => {
    expect(isProtectedPath(`.github/workflows/${file}`)).toBe(true);
  });

  it.each(trusted)("%s runs only on GitHub's machines", (file) => {
    const runsOn = readFileSync(join(DIR, file), "utf8")
      .split("\n")
      .filter((line) => /^\s*runs-on:/.test(line))
      .map((line) => line.trim());
    expect(runsOn.length).toBeGreaterThan(0);
    for (const line of runsOn) expect(line).toMatch(/^runs-on: ubuntu-[\w.-]+$/);
  });
});
