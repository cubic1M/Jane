import Anthropic from "@anthropic-ai/sdk";
import type { DocumentContentType } from "@/config/documents";
import { NOTICE_FIELDS, NOTICE_KINDS } from "@/config/tax-notices";
import { anthropic, finishedText, llmEnabled, llmModel } from "@/lib/anthropic";
import type { Fields } from "@/planning/tax-notice";

// Claude reads a tax notice off a photo or upload (spec step 217): which notice it is, the
// dates and the amount. The answer is held to a JSON schema and goes through the reading
// rules (src/planning/tax-notice.ts) before the person sees it. Without a key, nothing is
// read and the person types it from the notice. Never log the file or the answer.

const schema = {
  type: "object",
  properties: Object.fromEntries(NOTICE_FIELDS.map((f) => [f.key, { type: "string" }])),
  required: NOTICE_FIELDS.map((f) => f.key),
  additionalProperties: false,
};

const prompt = [
  "This is a notice or letter the person got from the IRS or a state tax agency. Read these values.",
  `kind: one of ${Object.keys(NOTICE_KINDS).join(", ")} (the notice code printed at the top, such as CP2000; STATE_PROPOSED or STATE_BALANCE for a state letter; OTHER if unsure).`,
  "issuer: irs, or the two-letter state code.",
  "taxYear: the four-digit tax year it is about.",
  "noticeDate and respondBy: as YYYY-MM-DD; respondBy is the date to respond or pay by.",
  "amount: in dollars as a plain number: the balance due, or the proposed additional tax.",
  "payer: for income that doesn't match, the payer named. reportedIncome: the income that payer reported, in dollars.",
  "reason: what the notice says in one plain line, with no advice.",
  "Leave any field you can't find as an empty string. Never guess.",
].join("\n");

export type NoticeReadResult =
  { kind: "claude"; fields: Fields } | { kind: "unavailable" } | { kind: "failed"; reason: string };

export async function readNotice(
  file: { bytes: Uint8Array; contentType: DocumentContentType },
  { claude = anthropic }: { claude?: typeof anthropic } = {},
): Promise<NoticeReadResult> {
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
      max_tokens: 700,
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
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { kind: "failed", reason: "not_json" };
  const answer = raw as Record<string, unknown>;
  const fields: Fields = {};
  for (const f of NOTICE_FIELDS) {
    const v = answer[f.key];
    if (typeof v === "string" && v.trim()) fields[f.key] = v.trim();
  }
  return { kind: "claude", fields };
}
