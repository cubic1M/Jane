import { isPersonId } from "@/config/people";
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
  // Who it is asked as: one of the sample lives (src/config/people.ts, "profile" in the files
  // QA writes), or the original demo bank when left out.
  person?: string;
  // Rules for the Haiku judge, beyond the fixed checks.
  judge?: { mustDo?: string[]; mustNot?: string[] };
  variantOf?: string;
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
    const profile = (item as { profile?: unknown }).profile;
    if (profile !== undefined && (typeof profile !== "string" || !isPersonId(profile))) {
      throw new Error(`${s.id}: "${String(profile)}" isn't a sample person.`);
    }
    const { profile: _drop, ...rest } = item as Scenario & { profile?: string };
    void _drop;
    return { ...rest, ...(profile ? { person: profile as string } : {}) } as Scenario;
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
      // Every account is the demo bank, which gets demo advice.
      profile: "demo_advice",
      ...(s.person ? { person: s.person } : {}),
      ...(s.judge ? { judge: s.judge } : {}),
    })),
  );
}

// What one graded message keeps between batches: the score and why, and the start of the
// answer for the worst-answers list. Demo-bank data only.
export type LiteResult = {
  id: string;
  text: string;
  status: "graded" | "skipped";
  score?: number;
  reason: string;
  answer?: string;
};

// Where a run of batches stands: the scenarios finished (every message graded) with their
// results, and what has been spent. Kept in docs/chat-eval-state.json on the eval branch, so
// the next batch resumes where the last stopped.
export type EvalState = { done: Record<string, LiteResult[]>; costCents: number };

export const emptyState = (): EvalState => ({ done: {}, costCents: 0 });

export function parseState(json: string): EvalState {
  const raw = JSON.parse(json) as Partial<EvalState>;
  return { done: raw.done ?? {}, costCents: raw.costCents ?? 0 };
}

// The scenarios in batch positions from..to (1-based, inclusive; either may be left out), that
// the state has not finished yet when resuming.
export function batchOf(
  scenarios: readonly Scenario[],
  { from, to, state }: { from?: number; to?: number; state?: EvalState },
): Scenario[] {
  return scenarios
    .slice(Math.max((from ?? 1) - 1, 0), to ?? scenarios.length)
    .filter((s) => !state?.done[s.id]);
}

export const liteOf = (r: CheckRun["results"][number]): LiteResult => ({
  id: r.id,
  text: r.text,
  status: r.status,
  ...(r.score === undefined ? {} : { score: r.score }),
  reason: r.reason.slice(0, 200),
  ...(r.answer ? { answer: r.answer.slice(0, 300) } : {}),
});

// Adds a batch's results to the state: a scenario counts as done when all its messages were
// graded (one cut short by the cap is asked again next time).
export function addToState(
  state: EvalState,
  batch: readonly Scenario[],
  results: CheckRun["results"],
  costCents: number,
): EvalState {
  const done = { ...state.done };
  for (const s of batch) {
    const ids = s.messages.map((_, i) => (i === 0 ? s.id : `${s.id}.${i + 1}`));
    const mine = ids.map((id) => results.find((r) => r.id === id));
    if (mine.every((r) => r?.status === "graded")) done[s.id] = mine.map((r) => liteOf(r!));
  }
  return { done, costCents: Math.round((state.costCents + costCents) * 100) / 100 };
}

export type CategoryReport = {
  category: string;
  asked: number;
  failed: number;
  skipped: number;
  // The share of graded messages that scored FAIL_BELOW or more.
  passPct: number | null;
  averageScore: number | null;
  failures: { id: string; text: string; score: number; reason: string; answer?: string }[];
};

export function reportByCategory(
  run: { results: readonly LiteResult[] },
  scenarios: readonly Scenario[],
): CategoryReport[] {
  const categoryOf = new Map<string, string>();
  for (const s of scenarios) {
    s.messages.forEach((_, i) => categoryOf.set(i === 0 ? s.id : `${s.id}.${i + 1}`, s.category));
  }
  const groups = new Map<string, LiteResult[]>();
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
          ...(r.answer ? { answer: r.answer } : {}),
        }));
      return {
        category,
        asked: graded.length,
        failed: failures.length,
        skipped: results.length - graded.length,
        passPct:
          graded.length === 0
            ? null
            : Math.round(((graded.length - failures.length) / graded.length) * 1000) / 10,
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
  const dollars = (cents: number) =>
    (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const lines = [
    `Last batch on ${meta.date}: ${meta.scenarios} scenarios finished so far, ${asked} messages graded, ${failed} failing (under ${FAIL_BELOW}), ${skipped} skipped. Cost so far ${dollars(meta.costCents)}; a batch is capped at ${dollars(meta.capCents)}${meta.stoppedAtCap ? " (the last one stopped at the cap)" : ""}.`,
    "",
    "| Category | Graded | Failing | Pass rate | Skipped | Average |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...reports.map(
      (r) =>
        `| ${r.category} | ${r.asked} | ${r.failed} | ${r.passPct === null ? "–" : `${r.passPct}%`} | ${r.skipped} | ${r.averageScore ?? "–"} |`,
    ),
  ];
  const worst = reports
    .flatMap((r) => r.failures.map((f) => ({ ...f, category: r.category })))
    .sort((a, b) => a.score - b.score)
    .slice(0, 20);
  if (worst.length > 0) {
    lines.push("", "**The 20 worst answers**", "");
    for (const w of worst) {
      lines.push(
        `- ${w.id} (${w.score}, ${w.category}): "${oneLine(w.text)}" — ${oneLine(w.reason)}${w.answer ? ` Answer began: "${oneLine(w.answer)}"` : ""}`,
      );
    }
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

// Several files at once: a comma list, with "*" allowed in a file name (docs/chat-scenarios*.json).
export function filesOf(spec: string, list: (dir: string) => string[]): string[] {
  return spec
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
    .flatMap((f) => {
      if (!f.includes("*")) return [f];
      const slash = f.lastIndexOf("/");
      const dir = slash < 0 ? "." : f.slice(0, slash);
      const pattern = new RegExp(
        `^${f
          .slice(slash + 1)
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")}$`,
      );
      return list(dir)
        .filter((name) => pattern.test(name))
        .sort()
        .map((name) => (slash < 0 ? name : `${dir}/${name}`));
    });
}

export function parseScenarioFiles(texts: readonly string[]): Scenario[] {
  const all = texts.flatMap((t) => parseScenarios(t));
  const seen = new Set<string>();
  for (const s of all) {
    if (seen.has(s.id)) throw new Error(`The id "${s.id}" is used in two files.`);
    seen.add(s.id);
  }
  return all;
}

// A fixed shuffle (the same every night, so batches by position resume): within each category
// in a seeded random order, then one from each category in turn, so any stretch of the list,
// and a run cut short by its cap, samples every category and, by the shuffle, every person.
export function quotaOrder(scenarios: readonly Scenario[], seed = 20261021): Scenario[] {
  let state = seed >>> 0;
  const random = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const byCategory = new Map<string, Scenario[]>();
  for (const s of scenarios) byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s]);
  const queues = shuffle([...byCategory.keys()].sort()).map((c) => shuffle(byCategory.get(c)!));
  const out: Scenario[] = [];
  while (queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
    }
  }
  return out;
}
