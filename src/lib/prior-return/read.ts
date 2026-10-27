import type { DocumentContentType } from "@/config/documents";
import { PRIOR_RETURN_FIELDS } from "@/config/prior-return";
import { anthropic } from "@/lib/anthropic";
import { readFields, type ReadResult } from "@/lib/read-fields";
import type { Fields } from "@/planning/prior-return";

// Claude reads a prior-year tax return off an uploaded copy (spec step 172). The answer is
// held to a JSON schema and every value then goes through the reading rules
// (src/planning/prior-return.ts) before the person sees it. Without a key, or when reading
// fails, nothing is read: the person fills the fields in. Never log the file or the answer.

const prompt = [
  "This is the person's filed US federal income tax return (Form 1040 and schedules). Read these values.",
  ...PRIOR_RETURN_FIELDS.map((f) => {
    const how =
      f.key === "filingStatus"
        ? "one of: single, married_joint, married_separate, head_of_household"
        : f.key === "deductionKind"
          ? "standard or itemized"
          : f.type === "year"
            ? "the four-digit year"
            : f.type === "signed"
              ? "in dollars as a plain number; negative if the person owed"
              : "in dollars as a plain number like 1234.56";
    return `${f.key}: ${f.label} (${f.line}), ${how}.`;
  }),
  "Leave any field you can't find as an empty string. Never guess.",
].join("\n");

export type ReturnReadResult = ReadResult<Fields>;

export async function readReturn(
  file: { bytes: Uint8Array; contentType: DocumentContentType },
  { claude = anthropic }: { claude?: typeof anthropic } = {},
): Promise<ReturnReadResult> {
  return readFields(file, {
    keys: PRIOR_RETURN_FIELDS.map((f) => f.key),
    prompt,
    maxTokens: 900,
    claude,
  });
}
