import { readFileSync } from "node:fs";
import {
  asksForCredentials,
  checkGuardrails,
  dollarFigures,
  linksElsewhere,
} from "@/lib/guardrails";
import { parseScenarioFiles, type Scenario } from "./scenarios";

// Plan item 13: grading answers Claude already wrote, with code, for free. recorded-answers.json
// holds the 124 answers of the 10-21 scenario run (sample data on the demo bank, each cut to its
// first 300 characters, with the score Claude's judge gave it). A rule added to the guardrails or
// the graders runs over real answers before anyone pays for fresh ones: it shows what the rule
// would have blocked, and where code still can't see what the judge saw.

export type RecordedAnswer = { id: string; text: string; answer: string; claudeScore: number };
export type Regraded = RecordedAnswer & { failed: string[] };

const CUT_AT = 300;
const OPENER =
  /^(?:sure|great question|good question|of course|certainly|absolutely|happy to help|i'?d be happy|okay|hmm)\b/i;
const MONEY_STYLE = /\$[\d,.]+\s*(?:\/\s?(?:mo|month|yr|year)\b|per (?:month|year)\b)/i;
const INTERNAL =
  /\b(?:propose_action|open_findings?|what_matters_most|finding_details|show_block|tool results?)\b/i;
// A prewritten line instead of Claude's own words (11-01): what the chat must no longer show.
const CANNED =
  /^(?:Sorry, I couldn't finish|I couldn't look into that|I couldn't answer that one in a way I'm sure is right|I can't help with that\. I'm glad to help)/;
const JANE_AS_SHE = /\bJane\b[^.!?]{0,40}\b(?:she|her)\b/;

export function regradeAnswer(recorded: RecordedAnswer, scenario?: Scenario): Regraded {
  const { answer } = recorded;
  const failed: string[] = [];
  // The profile it was answered under, with its figures taken as given: the run's tool results
  // weren't kept, so a figure can't be checked here.
  const check = checkGuardrails(
    answer,
    dollarFigures(answer).map((f) => f.cents),
    undefined,
    "demo_advice",
  );
  if (!check.ok) failed.push(...check.issues.map((issue) => `guardrail:${issue}`));
  if (linksElsewhere(answer).length > 0) failed.push("link");
  if (asksForCredentials(answer)) failed.push("credentials");
  if (CANNED.test(answer.trim())) failed.push("canned");
  if (OPENER.test(answer.trim())) failed.push("opener");
  if (MONEY_STYLE.test(answer)) failed.push("money_style");
  if (INTERNAL.test(answer)) failed.push("internal_name");
  if (JANE_AS_SHE.test(answer)) failed.push("jane_as_she");
  // What the scenario's author said to avoid, and what it should mention if the whole answer is here.
  if (scenario?.avoid && new RegExp(scenario.avoid, "i").test(answer)) failed.push("avoid");
  if (
    scenario?.mentions &&
    !CANNED.test(answer.trim()) &&
    answer.length < CUT_AT &&
    !new RegExp(scenario.mentions, "i").test(answer)
  ) {
    failed.push("mentions");
  }
  return { ...recorded, failed };
}

const SCENARIO_FILES = [
  "docs/chat-scenarios.json",
  "docs/chat-scenarios-2.json",
  "docs/chat-scenarios-3.json",
];

export function recordedAnswers(): RecordedAnswer[] {
  return JSON.parse(
    readFileSync("src/lib/jane-agent/checks/recorded-answers.json", "utf8"),
  ) as RecordedAnswer[];
}

export function regradeAll(recorded: readonly RecordedAnswer[] = recordedAnswers()) {
  const { scenarios } = parseScenarioFiles(SCENARIO_FILES.map((f) => readFileSync(f, "utf8")));
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const results = recorded.map((r) => regradeAnswer(r, byId.get(r.id.replace(/\.\d+$/, ""))));
  const counts: Record<string, number> = {};
  for (const r of results) for (const f of r.failed) counts[f] = (counts[f] ?? 0) + 1;
  return {
    results,
    counts,
    passed: results.filter((r) => r.failed.length === 0).length,
    // Where code and Claude's judge disagree: what the judge marked low and code can't yet see,
    // and what code fails that the judge passed.
    judgeLowCodePassed: results.filter((r) => r.claudeScore < 70 && r.failed.length === 0),
    codeFailedJudgeHigh: results.filter((r) => r.claudeScore >= 80 && r.failed.length > 0),
  };
}
