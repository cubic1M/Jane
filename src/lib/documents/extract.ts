import Anthropic from "@anthropic-ai/sdk";
import {
  DOCUMENT_KINDS,
  POLICY_TYPES,
  PREMIUM_FREQUENCIES,
  type DocumentContentType,
  type DocumentKind,
} from "@/config/documents";
import { anthropic, finishedText, llmEnabled, llmModel } from "@/lib/anthropic";
import { checkGuardrails } from "@/lib/guardrails";
import { factsFromClaude, type DocumentFacts } from "./facts";

// Claude reads the key facts off an uploaded document (spec step 68): who it's from, what
// it covers, the price and the dates. The answer is held to a JSON schema, read leniently,
// and the one-line summary must pass the guardrails before anyone sees it. Without an API
// key, or when reading fails, the person fills in the facts themselves.

const SCHEMA = {
  type: "object",
  properties: {
    provider: { type: "string" },
    policyType: { type: "string", enum: [...Object.keys(POLICY_TYPES), ""] },
    coverageSummary: { type: "string" },
    premium: { type: "string" },
    premiumFrequency: { type: "string", enum: [...Object.keys(PREMIUM_FREQUENCIES), ""] },
    renewalDate: { type: "string" },
    warrantyEndsOn: { type: "string" },
    purchaseDate: { type: "string" },
    purchaseAmount: { type: "string" },
  },
  required: [
    "provider",
    "policyType",
    "coverageSummary",
    "premium",
    "premiumFrequency",
    "renewalDate",
    "warrantyEndsOn",
    "purchaseDate",
    "purchaseAmount",
  ],
  additionalProperties: false,
};

const PROMPT_FOR: Record<DocumentKind, string> = {
  insurance_policy:
    "provider: the insurance company. policyType: the kind of policy. coverageSummary: what it covers. premium: the price per payment period. premiumFrequency: how often that price is paid. renewalDate: when the policy renews or the current term ends.",
  warranty:
    "provider: the company that gives the warranty. coverageSummary: what it covers. warrantyEndsOn: when it ends. purchaseDate and purchaseAmount: when the item was bought and for how much.",
  receipt:
    "provider: the store. coverageSummary: what was bought. purchaseDate and purchaseAmount: the date and the total paid.",
  tax_return:
    "provider: the tax preparer or software, if shown. coverageSummary: which tax year it is for.",
  other: "provider: who it's from. coverageSummary: what it is.",
};

function prompt(kind: DocumentKind): string {
  return [
    `This is the person's ${DOCUMENT_KINDS[kind].toLowerCase()}. Read the key facts from it.`,
    PROMPT_FOR[kind],
    "Write dates as YYYY-MM-DD and amounts in dollars as plain numbers like 1234.56.",
    "coverageSummary is one short, plain sentence of what the document says, with no dollar amounts and no advice.",
    "Leave any field you can't find, or that doesn't fit this document, as an empty string. Never guess.",
  ].join("\n");
}

function fileBlock(
  bytes: Uint8Array,
  contentType: DocumentContentType,
): Anthropic.ContentBlockParam {
  const data = Buffer.from(bytes).toString("base64");
  return contentType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: contentType, data } }
    : { type: "image", source: { type: "base64", media_type: contentType, data } };
}

export type ReadResult =
  | { kind: "claude"; facts: DocumentFacts; summaryRejected: boolean }
  | { kind: "unavailable" }
  | { kind: "failed"; reason: string };

type Options = { claude?: typeof anthropic };

export async function readDocumentFacts(
  file: { bytes: Uint8Array; contentType: DocumentContentType; kind: DocumentKind },
  { claude = anthropic }: Options = {},
): Promise<ReadResult> {
  if (!llmEnabled()) return { kind: "unavailable" };

  let text: string | null;
  try {
    const response = await claude().messages.create({
      model: llmModel(),
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            fileBlock(file.bytes, file.contentType),
            { type: "text", text: prompt(file.kind) },
          ],
        },
      ],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
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
  const field = (name: string) => (typeof answer[name] === "string" ? answer[name] : undefined);
  const facts = factsFromClaude(file.kind, {
    provider: field("provider"),
    policyType: field("policyType"),
    coverageSummary: field("coverageSummary"),
    premiumCents: field("premium"),
    premiumFrequency: field("premiumFrequency"),
    renewalDate: field("renewalDate"),
    warrantyEndsOn: field("warrantyEndsOn"),
    purchaseDate: field("purchaseDate"),
    purchaseAmountCents: field("purchaseAmount"),
  });

  // The summary is the only free text Claude writes here. Only the document's own amounts
  // may appear in it; anything that fails is dropped for the person to write.
  let summaryRejected = false;
  if (facts.coverageSummary) {
    const allowed = [facts.premiumCents, facts.purchaseAmountCents].filter(
      (c): c is number => c !== null,
    );
    if (!checkGuardrails(facts.coverageSummary, allowed).ok) {
      facts.coverageSummary = null;
      summaryRejected = true;
    }
  }
  return { kind: "claude", facts, summaryRejected };
}
