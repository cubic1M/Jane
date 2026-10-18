// The card text a page shows for a finding. Kept apart from explanations.ts, which
// writes explanations and needs the database.

import { EXPLAIN_PROMPT_VERSION, type FindingToExplain } from "./explain";
import { inputHash, prepareExplainInput } from "./explain-input";
import { templateExplanation, type ExplanationContent } from "./explain-templates";

export type StoredFinding = FindingToExplain & {
  explanation: unknown;
  explanationHash: string | null;
};

// The hash an up-to-date explanation of this finding would carry.
export function currentHash(finding: FindingToExplain): string {
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
