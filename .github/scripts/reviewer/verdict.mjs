#!/usr/bin/env node
// The verdict: reads what the reviewers returned as data, decides by decideVerdict, and posts one
// check from the reviewer's App. It runs nothing from the PR and no model. With no App key yet it
// reports in the job's summary and posts nothing.
import { createSign } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { founderApproval } from "../gates/core.mjs";
import {
  annotations,
  CHECK_NAME,
  cleanText,
  decideVerdict,
  labelChange,
  parseFindings,
  TIER_B_CHECKS,
} from "./core.mjs";

const { values: args } = parseArgs({
  options: {
    input: { type: "string" },
    reviews: { type: "string" },
    confirm: { type: "string" },
  },
});
const { REPO, FOUNDER_LOGINS = "", DETAILS_URL } = process.env;
const API = process.env.GITHUB_API_URL ?? "https://api.github.com";

async function call(token, method, path, body) {
  const response = await fetch(`${API}/${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "jane-reviewer",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path.split("?")[0]} answered ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function appJwt(appId, key) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: appId })}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(key, "base64url")}`;
}

/** A token good for checks and labels on this repo only, whatever else the App may do. */
async function appToken(appId, key) {
  const jwt = appJwt(appId, key);
  const installation = await call(jwt, "GET", `repos/${REPO}/installation`);
  const token = await call(jwt, "POST", `app/installations/${installation.id}/access_tokens`, {
    repositories: [REPO.split("/")[1]],
    permissions: { checks: "write", pull_requests: "write" },
  });
  return token.token;
}

function readReviews(dir) {
  const reviews = {};
  if (!existsSync(dir)) return reviews;
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    try {
      const data = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (data.family !== "claude" && data.family !== "second") continue;
      reviews[data.family] = {
        ok: data.ok === true,
        why: data.why,
        findings: parseFindings({ findings: data.findings ?? [] }).map((f) => ({
          ...f,
          family: data.family,
        })),
      };
    } catch {
      // A file that doesn't read is a review that didn't happen.
    }
  }
  return reviews;
}

// A finding counts only if a test run said so. The results come from a job that ran the PR's code, so
// they're read as data, and all they can do is say a finding the reviewers made was real.
function confirmedFindings(reviews, dir) {
  if (!dir || !existsSync(join(dir, "results.json"))) return [];
  let results = [];
  try {
    results = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")).results ?? [];
  } catch {
    return [];
  }
  const all = Object.values(reviews).flatMap((review) => review.findings);
  return results
    .filter((r) => r.outcome === "confirmed")
    .map((r) => all.find((f) => f.family === r.family && f.file === r.file && f.line === r.line))
    .filter(Boolean);
}

async function checkStates(sha, token) {
  const states = {};
  for (const name of TIER_B_CHECKS) {
    // Every run of that name: a PR's own workflow can add one, but can't hide a failed one.
    for (let wait = 0; ; wait += 1) {
      const path = `repos/${REPO}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}&filter=latest`;
      const { check_runs: runs } = await call(token, "GET", path);
      const pending = runs.some((run) => run.status !== "completed");
      if (!pending || wait >= 20) {
        if (runs.length === 0) states[name] = "missing";
        else if (pending) states[name] = "still running";
        else
          states[name] = runs.every((run) => run.conclusion === "success") ? "success" : "failed";
        break;
      }
      await new Promise((done) => setTimeout(done, 30_000));
    }
  }
  return states;
}

async function main() {
  const input = JSON.parse(readFileSync(join(args.input, "input.json"), "utf8"));
  const readToken = process.env.GH_TOKEN;
  const reviews = readReviews(args.reviews);
  const confirmed = confirmedFindings(reviews, args.confirm);
  let founder = { ok: false, why: "no approval" };
  if (input.number) {
    const list = await call(
      readToken,
      "GET",
      `repos/${REPO}/pulls/${input.number}/reviews?per_page=100`,
    );
    founder = founderApproval({
      reviews: list.map((r) => ({ login: r.user?.login, state: r.state, commit: r.commit_id })),
      founders: FOUNDER_LOGINS.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      author: input.author,
      headSha: input.sha,
    });
  }
  const checks = input.tier === "B" ? await checkStates(input.sha, readToken) : {};
  const verdict = decideVerdict({ ...input, reviews, confirmed, founder, checks });
  const notes = Object.values(reviews).flatMap((review) => review.findings);
  const tierLines = (input.tierFiles ?? [])
    .slice(0, 20)
    .map((f) => `- ${cleanText(f.file, 200)}: ${cleanText(f.why, 200)}`);
  const summary = [
    ...verdict.reasons.map((reason) => `- ${reason}`),
    "",
    `Tier ${input.tier}, set by:`,
    ...tierLines,
    "",
    `Findings, as notes unless a test confirmed them: ${notes.length}`,
    ...notes
      .slice(0, 20)
      .map((f) => `- ${f.family}, ${cleanText(f.file, 200)}:${f.line}: ${f.claim}`),
  ].join("\n");
  console.log(`${verdict.conclusion}: ${verdict.title}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${verdict.title}\n\n${summary}\n`);
  }
  if (process.env.APP_ID && process.env.APP_PRIVATE_KEY) {
    if (verdict.conclusion !== "success" && verdict.conclusion !== "failure") {
      throw new Error("A verdict is only ever success or failure.");
    }
    const token = await appToken(process.env.APP_ID, process.env.APP_PRIVATE_KEY);
    await call(token, "POST", `repos/${REPO}/check-runs`, {
      name: CHECK_NAME,
      head_sha: input.sha,
      status: "completed",
      conclusion: verdict.conclusion,
      details_url: DETAILS_URL,
      output: {
        title: verdict.title,
        summary: summary.slice(0, 60_000),
        annotations: annotations(notes),
      },
    });
    const change = labelChange(input.labels ?? [], verdict.blockedByFinding === true);
    if (input.number && change.add.length) {
      await call(token, "POST", `repos/${REPO}/issues/${input.number}/labels`, {
        labels: change.add,
      });
    }
    for (const label of change.remove) {
      await call(token, "DELETE", `repos/${REPO}/issues/${input.number}/labels/${label}`);
    }
  } else {
    console.log("No App key yet, so nothing was posted.");
  }
  // Red here too, so "re-run failed jobs" is how a founder's approval gets read.
  if (verdict.conclusion !== "success") process.exitCode = 1;
}

main();
