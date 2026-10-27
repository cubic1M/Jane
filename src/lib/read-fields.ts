import Anthropic from "@anthropic-ai/sdk";
import type { DocumentContentType } from "@/config/documents";
import { anthropic, finishedText, llmEnabled, llmModel } from "@/lib/anthropic";

// Claude reads named fields off an uploaded PDF or photo (a tax return, a tax notice, a
// policy's declarations page). The answer is held to a JSON schema of string fields, and each
// value found comes back trimmed; the caller's reading rules check it before the person sees
// it. Without a key, or when reading fails, nothing is read. Never log the file or the answer.

export type ReadResult<F> =
  { kind: "claude"; fields: F } | { kind: "unavailable" } | { kind: "failed"; reason: string };

export async function readFields<K extends string>(
  file: { bytes: Uint8Array; contentType: DocumentContentType },
  {
    keys,
    prompt,
    maxTokens,
    claude = anthropic,
  }: { keys: readonly K[]; prompt: string; maxTokens: number; claude?: typeof anthropic },
): Promise<ReadResult<Partial<Record<K, string>>>> {
  if (!llmEnabled()) return { kind: "unavailable" };
  const data = Buffer.from(file.bytes).toString("base64");
  const block: Anthropic.ContentBlockParam =
    file.contentType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: file.contentType, data } }
      : { type: "image", source: { type: "base64", media_type: file.contentType, data } };
  const schema = {
    type: "object",
    properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
    required: keys,
    additionalProperties: false,
  };
  let text: string | null;
  try {
    const response = await claude().messages.create({
      model: llmModel(),
      max_tokens: maxTokens,
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
  const fields: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = answer[key];
    if (typeof value === "string" && value.trim()) fields[key] = value.trim();
  }
  return { kind: "claude", fields };
}
