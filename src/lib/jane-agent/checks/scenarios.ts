import type { CheckRun } from "./run";
import type { CheckQuestion, Expect } from "./bank";
import { FAIL_BELOW } from "./history";

// A big file of realistic chat scenarios (written by QA, run overnight: `npm run checks:eval`,
// .github/workflows/chat-eval.yml). Each scenario is one conversation: the messages a person
// types in order, a category, and optionally what a good answer must or must not have. They
// are graded like the bank's questions (fixed checks, then Claude), and the per-category
// failures go into docs/chat-quality.md. Pure; the runner is eval.cli.test.ts.

export type Scenario = {
  id: string;
  category: string;
  // What is typed, in order. Later messages are follow-ups in the same conversation.
  messages: string[];
  // What every answer in it must (or must not) have; regexes as source text, matched
  // without regard to case.
  mentions?: string;
  avoid?: string;
  // An informational scenario: no action button (a link is fine).
  noButtons?: boolean;
  list?: boolean;
  maxChars?: number;
  profile?: "standard" | "demo_advice";
};

export function parseScenarios(json: string): Scenario[] {
  const raw: unknown = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("The scenarios file must be a JSON array.");
  const seen = new Set<string>();
  return raw.map((item, index) => {
    const s = item as Partial<Scenario>;
    const where = `scenario ${index + 1}`;
    if (!s.id || typeof s.id !== "string") throw new Error(`${where} needs an id.`);
    if (seen.has(s.id)) throw new Error(`${where}: the id "${s.id}" is used twice.`);
    seen.add(s.id);
    if (!s.category || typeof s.category !== "string") throw new Error(`${s.id} needs a category.`);
    if (
      !Array.isArray(s.messages) ||
      s.messages.length === 0 ||
      s.messages.some((m) => typeof m !== "string" || !m.trim())
    ) {
      throw new Error(`${s.id} needs at least one message.`);
    }
    for (const key of ["mentions", "avoid"] as const) {
      if (s[key] !== undefined) new RegExp(s[key]!, "i");
    }
    return s as Scenario;
  });
}

const expectOf = (s: Scenario): Expect => ({
  ...(s.mentions ? { mentions: new RegExp(s.mentions, "i") } : {}),
  ...(s.avoid ? { avoid: new RegExp(s.avoid, "i") } : {}),
  ...(s.noButtons ? { noButtons: true } : {}),
  ...(s.list ? { list: true } : {}),
  ...(s.maxChars ? { maxChars: s.maxChars } : {}),
});

// The scenarios as questions: the first message leads, the rest follow it. The category is
// the sector, so the run's grouping shows it.
export function scenarioQuestions(scenarios: readonly Scenario[]): CheckQuestion[] {
  return scenarios.flatMap((s) =>
    s.messages.map((text, i): CheckQuestion => ({
      id: i === 0 ? s.id : `${s.id}.${i + 1}`,
      text,
      needs: "claude",
      ...(i === 0 ? {} : { after: s.id }),
      expect: expectOf(s),
      sector: s.category,
      profile: s.profile ?? "standard",
    })),
  );
}

export type CategoryReport = {
  category: string;
  asked: number;
  failed: number;
  skipped: number;
  averageScore: number | null;
  failures: { id: string; text: string; score: number; reason: string }[];
};

export function reportByCategory(
  run: Pick<CheckRun, "results">,
  scenarios: readonly Scenario[],
): CategoryReport[] {
  const categoryOf = new Map<string, string>();
  for (const s of scenarios) {
    s.messages.forEach((_, i) => categoryOf.set(i === 0 ? s.id : `${s.id}.${i + 1}`, s.category));
  }
  const groups = new Map<string, CheckRun["results"]>();
  for (const r of run.results) {
    const category = categoryOf.get(r.id) ?? "other";
    groups.set(category, [...(groups.get(category) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([category, results]) => {
      const graded = results.filter((r) => r.status === "graded");
      const failures = graded
        .filter((r) => (r.score ?? 0) < FAIL_BELOW)
        .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
        .map((r) => ({
          id: r.id,
          text: r.text,
          score: r.score ?? 0,
          reason: r.reason.slice(0, 200),
        }));
      return {
        category,
        asked: graded.length,
        failed: failures.length,
        skipped: results.length - graded.length,
        averageScore:
          graded.length === 0
            ? null
            : Math.round(graded.reduce((sum, r) => sum + (r.score ?? 0), 0) / graded.length),
        failures,
      };
    })
    .sort((a, b) => b.failed - a.failed || a.category.localeCompare(b.category));
}

export const EVAL_START = "<!-- eval:start -->";
export const EVAL_END = "<!-- eval:end -->";

const oneLine = (text: string) => text.replace(/\s+/g, " ").replace(/\|/g, "/").trim();

// The "Scenario run" section: a table per category, then the failures worst first (the
// question and why, never the answer).
export function evalSection(
  reports: readonly CategoryReport[],
  meta: {
    date: string;
    scenarios: number;
    costCents: number;
    capCents: number;
    stoppedAtCap: boolean;
  },
): string {
  const asked = reports.reduce((sum, r) => sum + r.asked, 0);
  const failed = reports.reduce((sum, r) => sum + r.failed, 0);
  const skipped = reports.reduce((sum, r) => sum + r.skipped, 0);
  const lines = [
    `Run on ${meta.date}: ${meta.scenarios} scenarios, ${asked} messages graded, ${failed} failing (under ${FAIL_BELOW}), ${skipped} skipped. Cost ${(meta.costCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} of a ${(meta.capCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} cap${meta.stoppedAtCap ? " (stopped at the cap)" : ""}.`,
    "",
    "| Category | Graded | Failing | Skipped | Average |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...reports.map(
      (r) =>
        `| ${r.category} | ${r.asked} | ${r.failed} | ${r.skipped} | ${r.averageScore ?? "–"} |`,
    ),
  ];
  for (const r of reports.filter((x) => x.failures.length > 0)) {
    lines.push("", `**${r.category}**`, "");
    for (const f of r.failures.slice(0, 15)) {
      lines.push(`- ${f.id} (${f.score}): "${oneLine(f.text)}" — ${oneLine(f.reason)}`);
    }
    if (r.failures.length > 15) lines.push(`- …and ${r.failures.length - 15} more.`);
  }
  return lines.join("\n");
}

export function withEvalSection(doc: string, section: string): string {
  const block = `${EVAL_START}\n${section}\n${EVAL_END}`;
  if (doc.includes(EVAL_START) && doc.includes(EVAL_END)) {
    return doc.replace(new RegExp(`${EVAL_START}[\\s\\S]*?${EVAL_END}`), () => block);
  }
  return `${doc.trimEnd()}\n\n## Scenario run\n\nWritten by the overnight scenario run (.github/workflows/chat-eval.yml, \`npm run checks:eval\`).\n\n${block}\n`;
}
