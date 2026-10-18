import Anthropic from "@anthropic-ai/sdk";
import { anthropic, finishedText, llmEnabled, llmModel } from "@/lib/anthropic";
import {
  inputHash,
  prepareExplainInput,
  type ExplainableFinding,
  type ExplainInput,
} from "./explain-input";
import { templateExplanation, type ExplanationContent } from "./explain-templates";
import { checkGuardrails, type GuardrailIssue } from "./guardrails";

// Plain-language card text for a finding, written by Claude from the explain input only.
// Anything that goes wrong (no key, a refusal, malformed JSON, a guardrail failure) falls
// back to the template text for the finding's type.

export const EXPLAIN_PROMPT_VERSION = "explain-v1";

const MAX_TITLE = 80;
const MAX_EXPLANATION = 320;
const MAX_GIVE_UP = 160;
const MAX_ALTERNATIVE = 60;
const MAX_ALTERNATIVES = 3;

const SYSTEM = `You write the text on a card in a personal finance app. Each card shows one way the person may be losing money, found from their bank transactions. A concierge team handles the change by hand if the person says yes.

Write for someone who isn't a finance expert: short, warm, specific, no jargon.
- title: a short headline, under ${MAX_TITLE} characters.
- explanation: at most 2 sentences on what we found and why it costs them money.
- give_up: 1 sentence on what the person gives up if they make the change.
- alternatives: up to ${MAX_ALTERNATIVES} short options other than the main change (a few words each).

Rules:
- Use only dollar amounts that appear in the input, written exactly as they appear there. Don't calculate new amounts.
- Savings are estimates: say "could save" or "about". Never promise or guarantee a result.
- Never mention investing, stocks, funds, bonds, crypto, retirement accounts, taxes, or legal matters. A savings account is the only place to suggest for extra cash.`;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    explanation: { type: "string" },
    give_up: { type: "string" },
    alternatives: { type: "array", items: { type: "string" } },
  },
  required: ["title", "explanation", "give_up", "alternatives"],
  additionalProperties: false,
};

export type FindingToExplain = ExplainableFinding & { title: string };

export type ExplanationResult =
  | { kind: "llm"; content: ExplanationContent; model: string; hash: string }
  | {
      kind: "template";
      content: ExplanationContent;
      reason: "no_api_key" | "refused" | "invalid_output" | "guardrails";
      issues?: GuardrailIssue[];
      hash: string;
    }
  // The API was unreachable: show the template now and try again later.
  | { kind: "unavailable"; content: ExplanationContent; hash: string };

function sentences(text: string): number {
  return Math.max(1, (text.trim().match(/[.!?](?=\s|$)/g) ?? []).length);
}

// The answer's shape, or null if it isn't one we'd show.
export function parseExplanation(json: string): ExplanationContent | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const v = value as Record<string, unknown>;
  const strings = (x: unknown): x is string[] =>
    Array.isArray(x) && x.every((s) => typeof s === "string");
  if (
    typeof v?.title !== "string" ||
    typeof v.explanation !== "string" ||
    typeof v.give_up !== "string" ||
    !strings(v.alternatives)
  ) {
    return null;
  }

  const content: ExplanationContent = {
    title: v.title.trim(),
    explanation: v.explanation.trim(),
    giveUp: v.give_up.trim(),
    alternatives: v.alternatives
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, MAX_ALTERNATIVES),
  };
  const fits =
    content.title.length > 0 &&
    content.title.length <= MAX_TITLE &&
    content.explanation.length > 0 &&
    content.explanation.length <= MAX_EXPLANATION &&
    sentences(content.explanation) <= 2 &&
    content.giveUp.length > 0 &&
    content.giveUp.length <= MAX_GIVE_UP &&
    sentences(content.giveUp) === 1 &&
    content.alternatives.every((a) => a.length <= MAX_ALTERNATIVE);
  return fits ? content : null;
}

export function contentText(content: ExplanationContent): string {
  return [content.title, content.explanation, content.giveUp, ...content.alternatives].join("\n");
}

async function askClaude(input: ExplainInput): Promise<string | null> {
  const response = await anthropic().messages.create({
    model: llmModel(),
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(input) }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
  });
  return finishedText(response);
}

export async function explainFinding(finding: FindingToExplain): Promise<ExplanationResult> {
  const { input, allowedCents } = prepareExplainInput(finding);
  const hash = inputHash(input, EXPLAIN_PROMPT_VERSION);
  const template = templateExplanation(finding.title, input);
  if (!llmEnabled()) return { kind: "template", content: template, reason: "no_api_key", hash };

  let text: string | null;
  try {
    text = await askClaude(input);
  } catch (error) {
    if (!(error instanceof Anthropic.APIError)) throw error;
    console.error("Explanation request failed", { status: error.status });
    return { kind: "unavailable", content: template, hash };
  }
  if (text === null) return { kind: "template", content: template, reason: "refused", hash };

  const content = parseExplanation(text);
  if (!content) return { kind: "template", content: template, reason: "invalid_output", hash };

  const check = checkGuardrails(contentText(content), allowedCents, input.findingType);
  if (!check.ok) {
    return {
      kind: "template",
      content: template,
      reason: "guardrails",
      issues: check.issues,
      hash,
    };
  }
  return { kind: "llm", content, model: llmModel(), hash };
}
