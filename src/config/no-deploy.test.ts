import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_DEPLOY, writeNoDeploy } from "../../scripts/no-deploy.mjs";

// The record branches scripts push (ci-loop and the rest) carry a vercel.json that turns Vercel's Git
// deployments off, because Vercel reads it from the branch it builds, not from main. Without it every
// loop push was a failed Preview build: 18 in an hour on 11-19.

const scripts = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules") return [];
    return statSync(path).isDirectory() ? scripts(path) : path.endsWith(".mjs") ? [path] : [];
  });

describe("record branches turn Vercel's Git deployments off", () => {
  it("is the shape Vercel documents for every branch: git.deploymentEnabled false", () => {
    expect(Object.keys(NO_DEPLOY)).toEqual(["vercel.json"]);
    expect(JSON.parse(NO_DEPLOY["vercel.json"])).toEqual({ git: { deploymentEnabled: false } });
  });

  it("lands in the tree the loop commits to ci-loop, beside state.json and LOOP.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-tree-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
    git("init", "-q", "-b", "ci-loop");
    // As scripts/loop.mjs records it.
    writeFileSync(join(dir, "state.json"), "{}\n");
    writeFileSync(join(dir, "LOOP.md"), "# Loop\n");
    git("add", "state.json", "LOOP.md", ...writeNoDeploy(dir));
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "Loop");
    expect(git("ls-tree", "--name-only", "HEAD").split("\n")).toEqual([
      "LOOP.md",
      "state.json",
      "vercel.json",
    ]);
    expect(JSON.parse(git("show", "HEAD:vercel.json"))).toEqual({
      git: { deploymentEnabled: false },
    });
  });

  it("every script that pushes a record branch writes it, and a new one has to be added here", () => {
    const pushers = scripts("scripts").filter((f) =>
      readFileSync(f, "utf8").includes('git("push"'),
    );
    expect(pushers.sort()).toEqual(
      [
        "scripts/claim.mjs",
        "scripts/deploy-plan.mjs",
        "scripts/flake-list.mjs",
        "scripts/loop.mjs",
        "scripts/ops/data-branch.mjs",
      ].sort(),
    );
    for (const f of pushers) expect(readFileSync(f, "utf8"), f).toMatch(/writeNoDeploy\(dir\)/);
  });

  it("main's own vercel.json turns them off too: production ships from the deploy job, not Git", () => {
    const main = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(main.git).toEqual({ deploymentEnabled: false });
  });
});
