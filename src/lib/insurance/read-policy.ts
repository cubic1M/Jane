import Anthropic from "@anthropic-ai/sdk";
import type { DocumentContentType } from "@/config/documents";
import { COVERAGE_FIELDS, POLICY_KINDS, type PolicyKind } from "@/config/insurance";
import { anthropic, finishedText, llmEnabled, llmModel } from "@/lib/anthropic";
import type { Fields } from "./reading-rules";

// Claude reads a policy's deductible and cover limits off its declarations page or renewal
// notice (spec step 151); step 68 already read the insurer, price and renewal date. The
// answer is held to a JSON schema and every value then goes through the reading rules
// (src/lib/insurance/reading-rules.ts) before the person sees it. Without a key, or when
// reading fails, nothing is read: the fields are prefilled from payments instead.

const HOW: Record<string, string> = {
  money: "in dollars as a plain number like 100000",
  yesno: "as yes or no",
  years: "in whole years",
  percent: "as a whole percent like 80",
  days: "in whole days",
};

function schemaFor(kind: PolicyKind) {
  const keys = ["deductible", ...COVERAGE_FIELDS[kind].map((f) => f.key)];
  return {
    type: "object",
    properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
    required: keys,
    additionalProperties: false,
  };
}

function prompt(kind: PolicyKind): string {
  return [
    `This is the person's ${POLICY_KINDS[kind].toLowerCase()} insurance declarations page or renewal notice. Read its cover limits.`,
    "deductible: the deductible in dollars as a plain number.",
    ...COVERAGE_FIELDS[kind].map((f) => `${f.key}: ${f.label}, ${HOW[f.type]}.`),
    "Leave any field you can't find as an empty string. Never guess.",
  ].join("\n");
}

export type DetailsResult =
  { kind: "claude"; fields: Fields } | { kind: "unavailable" } | { kind: "failed"; reason: string };

export async function readPolicyDetails(
  file: { bytes: Uint8Array; contentType: DocumentContentType },
  kind: PolicyKind,
  { claude = anthropic }: { claude?: typeof anthropic } = {},
): Promise<DetailsResult> {
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
      max_tokens: 800,
      messages: [{ role: "user", content: [block, { type: "text", text: prompt(kind) }] }],
      output_config: { effort: "low", format: { type: "json_schema", schema: schemaFor(kind) } },
    });
    text = finishedText(response);
  } catch (error) {
    // Never log the file or the answer: they hold the person's details.
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
  const fields: Fields = {};
  const take = (from: string, to: string) => {
    const value = answer[from];
    if (typeof value === "string" && value.trim()) fields[to] = value.trim();
  };
  take("deductible", "deductible");
  for (const f of COVERAGE_FIELDS[kind]) take(f.key, `coverage.${f.key}`);
  return { kind: "claude", fields };
}
