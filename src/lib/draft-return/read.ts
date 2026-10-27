import type { DocumentContentType } from "@/config/documents";
import { DRAFT_FIELDS } from "@/config/draft-return";
import { anthropic } from "@/lib/anthropic";
import { readFields, type ReadResult } from "@/lib/read-fields";
import type { DraftFields } from "@/planning/draft-return";

// Claude reads a draft return off an uploaded copy (spec step 272). The answer is held to a JSON
// schema and every value then goes through the reading rules (src/planning/draft-return.ts)
// before the person sees it. Without a key, or when reading fails, nothing is read. Never log
// the file or the answer.

const prompt = [
  "This is a DRAFT US federal income tax return (Form 1040 and schedules) the person hasn't filed yet. Read these values as they appear on it.",
  ...DRAFT_FIELDS.map((f) => {
    const how =
      f.key === "filingStatus"
        ? "one of: single, married_joint, married_separate, head_of_household"
        : f.key === "deductionKind"
          ? "standard or itemized"
          : f.type === "year"
            ? "the four-digit year"
            : f.type === "signed"
              ? "in dollars as a plain number; negative if a loss or if the person owes"
              : "in dollars as a plain number like 1234.56";
    return `${f.key}: ${f.label} (${f.line}), ${how}.`;
  }),
  "Leave any field you can't find as an empty string. Never guess.",
].join("\n");

export type DraftReadResult = ReadResult<DraftFields>;

export async function readDraft(
  file: { bytes: Uint8Array; contentType: DocumentContentType },
  { claude = anthropic }: { claude?: typeof anthropic } = {},
): Promise<DraftReadResult> {
  return readFields(file, {
    keys: DRAFT_FIELDS.map((f) => f.key),
    prompt,
    maxTokens: 1200,
    claude,
  });
}
