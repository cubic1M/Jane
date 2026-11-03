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
  baselineDrops,
  bypassTurnedBackOn,
  founderApproval,
  fixMarking,
  isProtectedPath,
  isTestPath,
  isWatchedPath,
  parseNameStatus,
  scriptsChanged,
  testFilesGone,
  weakenedTests,
} from "./core.mjs";

const COMMENT_MARK = "<!-- gates:weakened-tests -->";
const BOT = "github-actions[bot]";

const { values: args } = parseArgs({
  options: {
    pr: { type: "string" },
    "pr-json": { type: "string" },
    base: { type: "string" },
    head: { type: "string" },
    comment: { type: "boolean", default: false },
  },
});

// A file name is the PR's to choose, so never let git read one as a pattern.
const git = (...a) =>
  execFileSync("git", ["--literal-pathspecs", ...a], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: "pipe",
  });
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
  const pages = gh("api", "--paginate", "--slurp", `repos/${repo}/pulls/${args.pr}/reviews`);
  const reviews = JSON.parse(pages)
    .flat()
    .map((r) => ({ login: r.user?.login, state: r.state, commit: r.commit_id }));
  return {
    title: pr.title,
    body: pr.body,
    branch: pr.headRefName,
    labels: pr.labels.map((l) => l.name),
    author: pr.author?.login,
    reviews,
  };
}

const changedFiles = (base, head) =>
  parseNameStatus(git("diff", "-z", "--name-status", "-M", base, head));

// The PR's own newest commit: the merge's second parent on GitHub, the commit itself in a local run.
function prHeadSha(head) {
  try {
    return git("rev-parse", "--verify", "-q", `${head}^2`).trim();
  } catch {
    return git("rev-parse", head).trim();
  }
}

// File names and test lines are the PR's words. One with a line break in it could start a workflow
// command of its own in the log.
const oneLine = (text) => String(text).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ");

function summary(lines) {
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
}

function annotate(level, message, file) {
  if (!process.env.GITHUB_ACTIONS) return;
  const escaped = (text) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const where = file ? ` file=${escaped(file).replace(/:/g, "%3A").replace(/,/g, "%2C")}` : "";
  console.log(`::${level}${where}::${escaped(message)}`);
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
    try {
      const drops = baselineDrops(JSON.parse(before), after === null ? null : JSON.parse(after));
      for (const d of drops) {
        const now = d.now === undefined ? "removed" : d.now;
        problems.push(`${file}: ${d.path} went from ${d.was} to ${now}`);
      }
    } catch (e) {
      problems.push(`${file}: can't be read as JSON (${e.message})`);
    }
  }
  return problems;
}

function protectedProblems(base, head, changes) {
  const problems = changes
    .filter((c) => isProtectedPath(c.file) || (c.from && isProtectedPath(c.from)))
    .map((c) => c.file);
  if (scriptsChanged(blob(base, "package.json"), blob(head, "package.json"))) {
    problems.push("package.json: its scripts changed");
  }
  const denyByDefault = "src/config/deny-by-default.ts";
  if (bypassTurnedBackOn(blob(base, denyByDefault), blob(head, denyByDefault))) {
    problems.push(`${denyByDefault}: the suite went back to running with a bypass`);
  }
  return problems;
}

function weakened(base, head, changes) {
  const fileDiffs = changes
    .filter((c) => isTestPath(c.file) && c.status !== "D" && c.status !== "A")
    .map((c) => ({
      file: c.file,
      // Both names, or git can't see a rename and reads the file as all new.
      diff: git("diff", "-M", "-U0", base, head, "--", ...(c.from ? [c.from] : []), c.file),
    }));
  return weakenedTests(fileDiffs, testFilesGone(changes));
}

// One comment per PR, kept up to date, so a founder can find these PRs by searching for its words.
function postComment(flags, watched) {
  const repo = process.env.GITHUB_REPOSITORY;
  const existing = JSON.parse(
    gh("api", "--paginate", "--slurp", `repos/${repo}/issues/${args.pr}/comments`),
  )
    .flat()
    // Only the bot's own: anyone can post a comment that starts with the mark.
    .find((c) => c.user?.login === BOT && (c.body ?? "").startsWith(COMMENT_MARK));
  if (!flags.length && !watched.length && !existing) return;
  const fenced = (lines) => `\`\`\`\n${lines.join("\n").replace(/```/g, "'''")}\n\`\`\``;
  const lines = flags.map((f) => {
    const change = f.now && f.was ? `${f.was}\n  now: ${f.now}` : f.was || f.now;
    return `${f.kind}: ${f.file}${change ? `\n  ${change}` : ""}`;
  });
  const sections = [
    flags.length ? `**Test lines weakened.**\n\n${fenced(lines)}` : "",
    watched.length ? `**Sensitive files changed.**\n\n${fenced(watched)}` : "",
  ].filter(Boolean);
  const body = sections.length
    ? `${COMMENT_MARK}\nWorth a look; this doesn't block the merge.\n\n${sections.join("\n\n")}`
    : `${COMMENT_MARK}\nNothing to look at any more.`;
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
    reviews: pr.reviews ?? [],
    founders,
    author: pr.author,
    headSha: prHeadSha(head),
  });

  const drops = baselineProblems(base, head);
  const protectedFiles = protectedProblems(base, head, changes);
  const watched = changes.filter((c) => isWatchedPath(c.file)).map((c) => oneLine(c.file));
  const flags = weakened(base, head, changes).map((f) => ({
    file: oneLine(f.file),
    kind: oneLine(f.kind),
    was: oneLine(f.was),
    now: oneLine(f.now),
  }));
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
  judged("Protected files changed", protectedFiles.map(oneLine), approval.ok);
  if ((drops.length || protectedFiles.length) && !approval.ok) {
    lines.push(
      `  - This needs a founder to approve this commit on GitHub: ${approval.why}.`,
      "  - Leave the PR open and tell a founder. Then re-run this check; a new push needs a new approval.",
    );
  }
  lines.push(`- Fix PR: ${fix.isFix ? "yes" : "no"} (${fix.why})`);
  lines.push(`- Tests weakened (a flag, not a block): ${flags.length}`);
  for (const f of flags) {
    const change = f.now && f.was ? `\`${f.was}\` now \`${f.now}\`` : `\`${f.was || f.now}\``;
    lines.push(`  - ${f.kind}, ${f.file}${f.was || f.now ? `: ${change}` : ""}`);
    annotate("warning", `${f.kind}: ${f.was || f.now || f.file}`, f.file);
  }
  lines.push(`- Sensitive files changed (a flag, not a block): ${watched.length}`);
  for (const file of watched) {
    lines.push(`  - ${file}`);
    annotate("warning", "A sensitive file changed: worth a founder's look", file);
  }
  summary(lines);

  if (args.comment) {
    // A comment that can't be posted (a fork's read-only token) never decides the gate.
    try {
      postComment(flags, watched);
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
