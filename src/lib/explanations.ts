import type { FindingStatus, PrismaClient } from "@/generated/prisma/client";
import { llmEnabled, llmModel } from "@/lib/anthropic";
import { SYSTEM_ACTOR, logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { EXPLAIN_PROMPT_VERSION, explainFinding, type FindingToExplain } from "./explain";
import { inputHash, prepareExplainInput } from "./explain-input";
import { templateExplanation, type ExplanationContent } from "./explain-templates";

// Explanations are cached on the finding with a hash of what Claude was sent. They are
// regenerated only when that input changes, i.e. when the finding's evidence does.

// Findings someone may still look at.
const SHOWN_STATUSES: FindingStatus[] = ["new", "shown", "approved", "in_progress"];
// Requests to Claude in flight at once for one user.
const CONCURRENCY = 4;

type StoredFinding = FindingToExplain & {
  explanation: unknown;
  explanationHash: string | null;
};

function currentHash(finding: FindingToExplain): string {
  return inputHash(prepareExplainInput(finding).input, EXPLAIN_PROMPT_VERSION);
}

function storedContent(value: unknown): ExplanationContent | null {
  const v = value as Record<string, unknown> | null;
  const ok =
    typeof v?.title === "string" &&
    typeof v.explanation === "string" &&
    typeof v.giveUp === "string" &&
    Array.isArray(v.alternatives) &&
    v.alternatives.every((a) => typeof a === "string");
  return ok ? (v as ExplanationContent) : null;
}

// What the card shows: the stored explanation while it matches the finding's evidence,
// otherwise the template text.
export function explanationFor(finding: StoredFinding): ExplanationContent {
  const { input } = prepareExplainInput(finding);
  if (finding.explanationHash === inputHash(input, EXPLAIN_PROMPT_VERSION)) {
    const stored = storedContent(finding.explanation);
    if (stored) return stored;
  }
  return templateExplanation(finding.title, input);
}

async function inBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(run))));
  }
  return results;
}

type Options = { client?: PrismaClient; explain?: typeof explainFinding };

export type ExplainSummary = { llm: number; template: number; unavailable: number };

// Writes explanations for the user's findings that don't have an up-to-date one. Without
// an API key it writes nothing: pages show template text by themselves.
export async function explainFindings(
  userId: string,
  { client = defaultClient, explain = explainFinding }: Options = {},
): Promise<ExplainSummary> {
  const summary: ExplainSummary = { llm: 0, template: 0, unavailable: 0 };
  if (!llmEnabled()) return summary;

  const db = scopedFor(userId, client);
  const findings = await db.findings.findMany({
    where: { status: { in: SHOWN_STATUSES } },
    select: {
      id: true,
      type: true,
      title: true,
      annualSavingsCents: true,
      evidence: true,
      explanationHash: true,
    },
    orderBy: { id: "asc" },
  });
  const stale = findings.filter((f) => f.explanationHash !== currentHash(f));

  const results = await inBatches(stale, CONCURRENCY, (f) => explain(f));
  for (const [i, result] of results.entries()) {
    summary[result.kind] += 1;
    if (result.kind === "unavailable") continue;
    if (result.kind === "template") {
      // Logs why, never the text: it may describe the person's spending.
      console.warn("Explanation fell back to template", {
        findingId: stale[i].id,
        reason: result.reason,
        issues: result.issues ?? [],
      });
    }
    await db.findings.update({
      where: { id: stale[i].id },
      data: {
        explanation: result.content,
        explanationSource: result.kind,
        explanationModel: result.kind === "llm" ? result.model : null,
        explanationPrompt: EXPLAIN_PROMPT_VERSION,
        explanationHash: result.hash,
      },
    });
  }

  if (summary.llm + summary.template > 0) {
    await logAudit(
      SYSTEM_ACTOR,
      "explanations_generated",
      { type: "user", id: userId },
      {
        llm: summary.llm,
        template: summary.template,
        model: llmModel(),
        prompt_version: EXPLAIN_PROMPT_VERSION,
      },
    );
  }
  return summary;
}
