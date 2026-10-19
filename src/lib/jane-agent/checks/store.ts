import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CheckRun, QuestionResult } from "./run";

// Saving Jane's answer-check runs (spec step 87) and comparing one with the last: the
// score, each question's grade, how quickly Jane starts answering and how many answers the
// guardrails blocked.

export async function saveRun(run: CheckRun, { client }: { client: PrismaClient }) {
  return client.answerCheckRun.create({
    data: {
      mode: run.mode,
      promptVersion: run.promptVersion,
      score: run.score,
      graded: run.graded,
      skipped: run.skipped,
      costCents: Math.ceil(run.costCents),
      stoppedAtCap: run.stoppedAtCap,
      firstWordsMs: run.firstWordsMs?.median ?? null,
      results: run as unknown as Prisma.InputJsonObject,
    },
    select: { id: true, createdAt: true },
  });
}

// The run before this one in the same mode (rules-only runs compare with rules-only).
export async function previousRun(
  { client }: { client: PrismaClient },
  mode: CheckRun["mode"],
  before: Date,
): Promise<CheckRun | null> {
  const row = await client.answerCheckRun.findFirst({
    where: { mode, createdAt: { lt: before } },
    orderBy: { createdAt: "desc" },
    select: { results: true },
  });
  return row ? (row.results as unknown as CheckRun) : null;
}

const blocked = (results: readonly QuestionResult[]) =>
  results.filter((r) => r.source === "claude_blocked").length;

export type Comparison = {
  scoreChange: number | null;
  blocked: { before: number; after: number };
  firstWordsMs: { before: number | null; after: number | null };
  // Questions whose score changed, the biggest change first.
  changed: { id: string; before: number | null; after: number | null }[];
};

export function compareRuns(before: CheckRun, after: CheckRun): Comparison {
  const old = new Map(before.results.map((r) => [r.id, r.score ?? null]));
  const changed = after.results
    .map((r) => ({ id: r.id, before: old.get(r.id) ?? null, after: r.score ?? null }))
    .filter((c) => c.before !== c.after)
    .sort(
      (a, b) =>
        Math.abs((b.after ?? 0) - (b.before ?? 0)) - Math.abs((a.after ?? 0) - (a.before ?? 0)),
    );
  return {
    scoreChange: before.score === null || after.score === null ? null : after.score - before.score,
    blocked: { before: blocked(before.results), after: blocked(after.results) },
    firstWordsMs: {
      before: before.firstWordsMs?.median ?? null,
      after: after.firstWordsMs?.median ?? null,
    },
    changed,
  };
}

// The run as plain text, for the terminal.
export function formatRun(run: CheckRun, comparison: Comparison | null = null): string {
  const lines = [
    `Jane's answer checks: ${run.mode === "full" ? "full run" : "rules only"} (${run.promptVersion})`,
    `Score ${run.score ?? "-"} over ${run.graded} graded, ${run.skipped} skipped.`,
    `Claude's grading: ${run.claudeGrading}`,
    `Spent ${run.costCents.toFixed(2)}¢ of a ${run.capCents}¢ cap${run.stoppedAtCap ? ": stopped at the cap" : ""}.`,
    run.firstWordsMs
      ? `First words: ${run.firstWordsMs.median} ms median, ${run.firstWordsMs.max} ms slowest.`
      : "First words: -",
    `Blocked by the guardrails: ${
      Object.entries(run.blockedBy ?? {})
        .map(([code, n]) => `${code} ${n}`)
        .join(", ") || "none"
    }.`,
  ];
  if (comparison) {
    lines.push(
      `Since the last run: score ${comparison.scoreChange === null ? "-" : `${comparison.scoreChange >= 0 ? "+" : ""}${comparison.scoreChange}`}, blocked ${comparison.blocked.before} → ${comparison.blocked.after}.`,
      ...comparison.changed
        .slice(0, 15)
        .map((c) => `  ${c.id}: ${c.before ?? "-"} → ${c.after ?? "-"}`),
    );
  }
  lines.push("");
  for (const r of run.results) {
    lines.push(
      r.status === "graded"
        ? `${String(r.score).padStart(3)}  ${r.id}  "${r.text}"  ${r.reason}`
        : `  -  ${r.id}  "${r.text}"  ${r.reason}`,
    );
  }
  return lines.join("\n");
}
