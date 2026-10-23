import Anthropic from "@anthropic-ai/sdk";
import type { DocumentContentType } from "@/config/documents";
import { DRAFT_FIELDS } from "@/config/draft-return";
import { anthropic, finishedText, llmEnabled, llmModel } from "@/lib/anthropic";
import type { DraftFields } from "@/planning/draft-return";

// Claude reads a draft return off an uploaded copy (spec step 272). The answer is held to a JSON
// schema and every value then goes through the reading rules (src/planning/draft-return.ts)
// before the person sees it. Without a key, or when reading fails, nothing is read. Never log
// the file or the answer.

const schema = {
  type: "object",
  properties: Object.fromEntries(DRAFT_FIELDS.map((f) => [f.key, { type: "string" }])),
  required: DRAFT_FIELDS.map((f) => f.key),
  additionalProperties: false,
};

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

export type DraftReadResult =
  | { kind: "claude"; fields: DraftFields }
  | { kind: "unavailable" }
  | { kind: "failed"; reason: string };

export async function readDraft(
  file: { bytes: Uint8Array; contentType: DocumentContentType },
  { claude = anthropic }: { claude?: typeof anthropic } = {},
): Promise<DraftReadResult> {
  if (!llmEnabled()) return { kind: "unavailable" };
  const data = Buffer.from(file.bytes).toString("base64");
  const block: Anthropic.ContentBlockParam =
    file.contentType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: file.contentType, data } }
      : { type: "image", source: { type: "base64", media_type: file.contentType, data } };
  let text: string | null;
  try {
    const response = await claude().messages.create({
      model: llmModel(),
      max_tokens: 1200,
      messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
    });
    text = finishedText(response);
  } catch (error) {
    if (error instanceof Anthropic.APIError)
      return { kind: "failed", reason: `api_${error.status}` };
    return { kind: "failed", reason: "error" };
  }
  if (!text) return { kind: "failed", reason: "unfinished" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: "failed", reason: "not_json" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "failed", reason: "not_json" };
  }
  const answer = raw as Record<string, unknown>;
  const fields: DraftFields = {};
  for (const f of DRAFT_FIELDS) {
    const value = answer[f.key];
    if (typeof value === "string" && value.trim()) fields[f.key] = value.trim();
  }
  return { kind: "claude", fields };
}
