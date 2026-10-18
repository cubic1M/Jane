import Anthropic from "@anthropic-ai/sdk";
import { anthropic, finishedText, llmEnabled, llmModel } from "@/lib/anthropic";

// Reads a company's reply to the agent into what happens next. Claude reads it when it's
// available; otherwise (or if Claude's answer doesn't fit) a few plain word rules do, and
// anything they can't place goes to the team rather than being guessed.

export type ReplyOutcome =
  // The company did what was asked (a refund issued, the old price kept).
  | "done"
  // The company said no.
  | "refused"
  // The company asked for something only the person can give (a detail, a confirmation).
  | "needs_info"
  // The company insists the account holder contacts them directly.
  | "needs_person"
  // Can't tell.
  | "unclear";

export type ReplyReading = {
  outcome: ReplyOutcome;
  // One plain sentence for the timeline and the person, e.g. "Target says the $64.20
  // refund will reach your card in 5 days."
  summary: string;
  // For needs_info: what the company asked, in plain words.
  question: string | null;
  source: "llm" | "rules";
};

const OUTCOMES: readonly ReplyOutcome[] = [
  "done",
  "refused",
  "needs_info",
  "needs_person",
  "unclear",
];

const RULES: { outcome: ReplyOutcome; patterns: RegExp[] }[] = [
  {
    outcome: "needs_person",
    patterns: [
      /\baccount holder (must|needs to|has to)\b/i,
      /\bverify (your|their) identity\b/i,
      /\bcall us\b/i,
    ],
  },
  {
    outcome: "refused",
    patterns: [
      /\bunable to\b/i,
      /\bcannot\b/i,
      /\bcan't\b/i,
      /\bnot eligible\b/i,
      /\bdeclin/i,
      /\bdeny\b/i,
    ],
  },
  {
    outcome: "done",
    patterns: [
      /\brefund (has been|was|is being) (processed|issued|approved)\b/i,
      /\b(processed|issued|approved) (a|the|your) refund\b/i,
      /\bkeep (your|the) (previous|old|current) price\b/i,
      /\bwe('ve| have) (applied|reversed|credited)\b/i,
    ],
  },
  {
    outcome: "needs_info",
    patterns: [
      /\bplease (provide|send|confirm|reply with)\b/i,
      /\bcould you (provide|send|confirm)\b/i,
      /\bwe need\b/i,
    ],
  },
];

// Sentences of a reply, without the greeting, thanks and sign-off around the point.
const FILLER =
  /^(hi|hello|hey|dear)\b|^thanks?( you)?\b|^(best|regards|sincerely|cheers)\b|support$/i;
function sentences(body: string): string[] {
  return body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(">"))
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.replace(/^(hi|hello|hey)\b[^,]*,\s*/i, "").trim())
    .filter((sentence) => sentence.length > 3 && !FILLER.test(sentence));
}

// The rules read the body alone: a subject line ("Re: Request from ...") isn't the answer.
export function readReplyByRules(body: string): ReplyReading {
  const rule = RULES.find((r) => r.patterns.some((p) => p.test(body)));
  const outcome = rule?.outcome ?? "unclear";
  const all = sentences(body);
  // The sentence that says what happened, or the first that isn't a pleasantry.
  const point =
    (rule && all.find((sentence) => rule.patterns.some((p) => p.test(sentence)))) ?? all[0] ?? "";
  const summary = point.slice(0, 240) || "The company replied.";
  return {
    outcome,
    summary,
    question: outcome === "needs_info" ? summary : null,
    source: "rules",
  };
}

const SYSTEM = `You read a company's email reply to an assistant that wrote on a customer's behalf, asking for a refund or a better price. Say what happened, using only what the reply says.

outcome:
- "done": they did what was asked (refund issued or approved, old price kept, credit applied).
- "refused": they said no.
- "needs_info": they asked for a detail or confirmation before acting.
- "needs_person": they require the account holder to contact them directly or verify identity.
- "unclear": anything else.

summary: one plain sentence for the customer, no more than 30 words, no promises.
question: for needs_info, what they asked for, in plain words; otherwise an empty string.`;

const SCHEMA = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: OUTCOMES },
    summary: { type: "string" },
    question: { type: "string" },
  },
  required: ["outcome", "summary", "question"],
  additionalProperties: false,
};

export async function readReply(
  reply: { subject: string; body: string },
  { client = anthropic } = {},
): Promise<ReplyReading> {
  const fallback = readReplyByRules(reply.body);
  if (!llmEnabled()) return fallback;
  let text: string | null;
  try {
    const response = await client().messages.create({
      model: llmModel(),
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(reply) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    });
    text = finishedText(response);
  } catch (error) {
    if (!(error instanceof Anthropic.APIError)) throw error;
    console.error("Reading a reply failed", { status: error.status });
    return fallback;
  }
  if (text === null) return fallback;
  try {
    const parsed = JSON.parse(text) as { outcome?: unknown; summary?: unknown; question?: unknown };
    if (
      !OUTCOMES.includes(parsed.outcome as ReplyOutcome) ||
      typeof parsed.summary !== "string" ||
      !parsed.summary.trim()
    ) {
      return fallback;
    }
    const question =
      typeof parsed.question === "string" && parsed.question.trim() ? parsed.question.trim() : null;
    return {
      outcome: parsed.outcome as ReplyOutcome,
      summary: parsed.summary.trim().slice(0, 300),
      question: parsed.outcome === "needs_info" ? (question ?? parsed.summary.trim()) : null,
      source: "llm",
    };
  } catch {
    return fallback;
  }
}
