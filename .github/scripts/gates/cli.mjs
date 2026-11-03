#!/usr/bin/env node
// The static gates on one pull request: baselines, protected files, weakened tests. It reads the
// PR's files as text with git and never runs them, so it is safe under pull_request_target.
//
//   node cli.mjs --pr 123 --base <sha> --head <sha> [--comment]
//   node cli.mjs --pr-json pr.json --base <sha> --head <sha>     (no GitHub: for a local run)
//
// Exits 1 when a gate fails. On GitHub it also writes the step summary, and sets `proof` when the
// PR is a fix that proof.mjs must check.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  BASELINE_FILES,
  BASELINE_TESTS,
  FOUNDER_LABEL,
  allowedDrop,
  baselineDrops,
  founderApproval,
  fixMarking,
  isProtectedPath,
  isTestPath,
  weakenedTests,
} from "./core.mjs";

const COMMENT_MARK = "<!-- gates:weakened-tests -->";

const { values: args } = parseArgs({
  options: {
    pr: { type: "string" },
    "pr-json": { type: "string" },
    base: { type: "string" },
    head: { type: "string" },
    comment: { type: "boolean", default: false },
  },
});

const git = (...a) =>
  execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: "pipe" });
const gh = (...a) => execFileSync("gh", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const blob = (rev, file) => {
  try {
    return git("show", `${rev}:${file}`);
  } catch {
    return null;
  }
};

function loadPr() {
  if (args["pr-json"]) return JSON.parse(readFileSync(args["pr-json"], "utf8"));
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = JSON.parse(
    gh("pr", "view", args.pr, "--repo", repo, "--json", "title,body,headRefName,labels,author"),
  );
  // Every page's labelled events, oldest first: who put each label on, and when.
  const pages = gh("api", "--paginate", "--slurp", `repos/${repo}/issues/${args.pr}/timeline`);
  const labelEvents = JSON.parse(pages)
    .flat()
    .filter((e) => e.event === "labeled")
    .map((e) => ({ label: e.label?.name, actor: e.actor?.login, at: e.created_at }));
  return {
    title: pr.title,
    body: pr.body,
    branch: pr.headRefName,
    labels: pr.labels.map((l) => l.name),
    author: pr.author?.login,
    labelEvents,
  };
}

function changedFiles(base, head) {
  return git("diff", "--name-status", "-M", base, head)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      return { status: parts[0][0], file: parts[parts.length - 1], from: parts[1] };
    });
}

// The PR's own newest commit: the merge's second parent on GitHub, the commit itself in a local run.
function newestCommitDate(head) {
  try {
    return git("show", "-s", "--format=%cI", `${head}^2`).trim();
  } catch {
    return git("show", "-s", "--format=%cI", head).trim();
  }
}

function summary(lines) {
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
}

function annotate(level, message, file) {
  if (!process.env.GITHUB_ACTIONS) return;
  const where = file ? ` file=${file}` : "";
  console.log(`::${level}${where}::${message.replace(/\n/g, "%0A")}`);
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function baselineProblems(base, head) {
  const problems = [];
  for (const file of BASELINE_FILES) {
    const before = blob(base, file);
    if (before === null) continue;
    const after = blob(head, file);
    const drops = baselineDrops(JSON.parse(before), after === null ? null : JSON.parse(after));
    for (const d of drops) {
      const now = d.now === null ? "removed" : d.now;
      problems.push(`${file}: ${d.path} went from ${d.was} to ${now}`);
    }
  }
  for (const file of BASELINE_TESTS) {
    const was = allowedDrop(blob(base, file));
    const now = allowedDrop(blob(head, file));
    if (was !== null && now !== was && (now === null || now > was)) {
      problems.push(`${file}: ALLOWED_DROP went from ${was} to ${now ?? "removed"}`);
    }
  }
  return problems;
}

function weakened(base, head, changes) {
  const paths = changes.filter((c) => isTestPath(c.file) && c.status !== "D").map((c) => c.file);
  const deleted = changes.filter((c) => c.status === "D").map((c) => c.file);
  const diff = paths.length ? git("diff", "-M", "-U0", base, head, "--", ...paths) : "";
  return weakenedTests(diff, deleted);
}

// One comment per PR, kept up to date, so a founder can find these PRs by searching for its words.
function postComment(flags) {
  const repo = process.env.GITHUB_REPOSITORY;
  const existing = JSON.parse(
    gh("api", "--paginate", "--slurp", `repos/${repo}/issues/${args.pr}/comments`),
  )
    .flat()
    .find((c) => (c.body ?? "").startsWith(COMMENT_MARK));
  if (!flags.length && !existing) return;
  const lines = flags.map((f) => {
    const change = f.now && f.was ? `${f.was}\n  now: ${f.now}` : f.was || f.now;
    return `${f.kind}: ${f.file}${change ? `\n  ${change}` : ""}`;
  });
  const fence = lines.join("\n").replace(/```/g, "'''");
  const body = flags.length
    ? `${COMMENT_MARK}\n**Test lines weakened.** Worth a look; this doesn't block the merge.\n\n\`\`\`\n${fence}\n\`\`\``
    : `${COMMENT_MARK}\nNo test lines weakened any more.`;
  if (existing) {
    gh("api", "-X", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "-f", `body=${body}`);
  } else {
    gh("api", `repos/${repo}/issues/${args.pr}/comments`, "-f", `body=${body}`);
  }
}

function main() {
  const { base, head } = args;
  const pr = loadPr();
  const changes = changedFiles(base, head);
  const founders = (process.env.FOUNDER_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const approval = founderApproval({
    labels: pr.labels,
    labelEvents: pr.labelEvents ?? [],
    founders,
    author: pr.author,
    headCommitDate: newestCommitDate(head),
  });

  const drops = baselineProblems(base, head);
  const protectedFiles = changes.filter(
    (c) => isProtectedPath(c.file) || (c.from && isProtectedPath(c.from)),
  );
  const flags = weakened(base, head, changes);
  const fix = fixMarking(pr);

  const failures = [];
  const lines = ["## Gates", ""];
  const judged = (title, items, ok) => {
    if (!items.length) {
      lines.push(`- ${title}: pass`);
      return;
    }
    lines.push(`- ${title}: ${ok ? `allowed (${approval.why})` : "**FAIL**"}`);
    for (const item of items) lines.push(`  - ${item}`);
    if (!ok) failures.push(title);
  };
  judged("Accuracy baselines only rise", drops, approval.ok);
  judged(
    "Protected files changed",
    protectedFiles.map((c) => c.file),
    approval.ok,
  );
  if ((drops.length || protectedFiles.length) && !approval.ok) {
    lines.push(
      `  - This needs a founder to put the "${FOUNDER_LABEL}" label on the PR: ${approval.why}.`,
      "  - Agents never apply this label. Leave the PR open and tell a founder.",
    );
  }
  lines.push(`- Fix PR: ${fix.isFix ? "yes" : "no"} (${fix.why})`);
  lines.push(`- Tests weakened (a flag, not a block): ${flags.length}`);
  for (const f of flags) {
    const change = f.now && f.was ? `\`${f.was}\` now \`${f.now}\`` : `\`${f.was || f.now}\``;
    lines.push(`  - ${f.kind}, ${f.file}${f.was || f.now ? `: ${change}` : ""}`);
    annotate("warning", `${f.kind}: ${f.was || f.now || f.file}`, f.file);
  }
  summary(lines);

  if (args.comment) {
    // A comment that can't be posted (a fork's read-only token) never decides the gate.
    try {
      postComment(flags);
    } catch (e) {
      console.log(`couldn't update the comment: ${e.message}`);
    }
  }
  output("proof", fix.isFix ? "true" : "false");
  if (failures.length) {
    annotate("error", `Gate failed: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main();
