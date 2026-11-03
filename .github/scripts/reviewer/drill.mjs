#!/usr/bin/env node
// The weekly planted-bug drill. Plants surviving mutants in diffs (no PR, no push), asks the reviewers
// the same way a PR would and records how many they catch (docs/gates.md). A plant alone would be the
// only thing in its diff to comment on, so it's hidden among a real past commit's changes.
//   node drill.mjs --report mutation.json --count 5 --week 2026-W45 --out drill.json
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { caughtPlant, cleanText, pickDecoy, pickSurvivors, plantedDiff } from "./core.mjs";

const { values: args } = parseArgs({
  options: {
    report: { type: "string" },
    count: { type: "string", default: "5" },
    week: { type: "string" },
    out: { type: "string" },
    families: { type: "string", default: "claude,second" },
  },
});

const review = join(import.meta.dirname, "review.mjs");

function ask(family, diff) {
  const dir = mkdtempSync(join(tmpdir(), "drill-"));
  writeFileSync(join(dir, "diff.txt"), diff);
  const out = join(dir, "out.json");
  spawnSync(
    process.execPath,
    [review, "--family", family, "--diff", join(dir, "diff.txt"), "--out", out],
    {
      stdio: "ignore",
    },
  );
  return JSON.parse(readFileSync(out, "utf8"));
}

const git = (...a) =>
  execFileSync("git", a, { encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });

// Real commits from main's history, as diffs. A shallow checkout has few, and a plant then stands alone.
function realDiffs() {
  try {
    return git("log", "-n", "60", "--no-merges", "--format=%H", "--", "src")
      .split("\n")
      .filter(Boolean)
      .map((sha) => ({
        sha,
        diff: git("show", "--format=", "--no-color", "--no-ext-diff", sha, "--", "src"),
      }));
  } catch {
    return [];
  }
}

function main() {
  const report = JSON.parse(readFileSync(args.report, "utf8"));
  const plants = pickSurvivors(report, Number(args.count), args.week);
  const families = args.families.split(",");
  const tally = Object.fromEntries(
    families.map((f) => [f, { caught: 0, missed: 0, didNotFinish: 0, otherFindings: 0 }]),
  );
  const rows = [];
  const real = realDiffs();
  for (const plant of plants) {
    const { diff: planted, firstLine, lastLine } = plantedDiff(plant);
    const decoy = pickDecoy(real, plant.path, args.week);
    const diff = decoy ? `${decoy.diff}\n${planted}` : planted;
    const row = {
      path: plant.path,
      line: firstLine,
      mutator: plant.mutant.mutatorName,
      hiddenIn: decoy?.sha ?? null,
    };
    for (const family of families) {
      const answer = ask(family, diff);
      if (!answer.ok) {
        tally[family].didNotFinish += 1;
        row[family] = "didn't finish";
        continue;
      }
      const hit = caughtPlant(answer.findings, { path: plant.path, firstLine, lastLine });
      tally[family][hit ? "caught" : "missed"] += 1;
      tally[family].otherFindings += hit ? answer.findings.length - 1 : answer.findings.length;
      row[family] = hit ? "caught" : "missed";
      if (hit) {
        const near = answer.findings.find((f) =>
          caughtPlant([f], { path: plant.path, firstLine, lastLine }),
        );
        row[`${family}Said`] = cleanText(near.claim);
      }
    }
    rows.push(row);
  }
  const result = { week: args.week, planted: plants.length, tally, rows };
  writeFileSync(args.out, JSON.stringify(result, null, 2));
  for (const [family, t] of Object.entries(tally)) {
    console.log(
      `${family}: caught ${t.caught} of ${plants.length} (${t.didNotFinish} didn't finish)`,
    );
  }
}

main();
