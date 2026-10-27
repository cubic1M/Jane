import Anthropic from "@anthropic-ai/sdk";
import { GRADER_MODEL } from "@/config/answer-checks";
import { finishedText } from "@/lib/anthropic";
import type { Facts } from "./facts";
import { formatCents } from "@/lib/money";

// Claude's grade for one of Jane's answers (spec step 87), against a written rubric for what
// the fixed checks can't see: is it useful, and does it sound like Jane. Only with an
// Anthropic key; the runner counts what it costs.

export const GRADER_VERSION = "grader-v3";

const RUBRIC = `You grade answers from Jane, the money helper in a personal finance app's chat. You get the person's question (and the conversation before it), Jane's answer, the buttons under it, and the person's main numbers.

Score two things from 1 to 5:

usefulness
5: answers the actual question in the first sentence, with the person's own figures; gives the reason; suggests one clear next step that would save them the most, with its button; nothing for the person to work out.
4: answers it with their figures, but the reason or the next step is weak.
3: partly answers it, or answers a slightly different question.
2: mostly general advice, or makes the person do the work ("tap the button", "check your bills").
1: doesn't answer, misreads the question, or gets the figures wrong.

tone
5: warm, brief and plain; no filler or jargon; money as "$17.99 a month" and dates as "Oct 28 (in 3 days)".
3: correct but stiff, wordy or repetitive.
1: cold, salesy, preachy, or padded.

A button is only right when the person asked Jane to do something; a button on an informational answer is a fault. Never reward investment, tax or legal advice. Give a reason of one or two sentences naming what to fix.

Some questions come with rules: "mustDo" (the answer has to do each of these) and "mustNot" (it must not do any of these). In "rulesBroken" list, in a few words each, every mustDo the answer missed and every mustNot it did, judging only this answer against the person's numbers. Leave it empty when all hold or when there are no rules. Rules that hold for every answer: it must not invent figures (a figure is invented only if it is not in "figuresFromTheirData" or the numbers given, and is not a simple sum or difference of them), must not speak of buttons or links "under this answer", must not answer a specific question with a general status of where they stand, and must say plainly when Jane can't do something.`;

const SCHEMA = {
  type: "object",
  properties: {
    usefulness: { type: "integer", enum: [1, 2, 3, 4, 5] },
    tone: { type: "integer", enum: [1, 2, 3, 4, 5] },
    reason: { type: "string" },
    rulesBroken: { type: "array", items: { type: "string" } },
  },
  required: ["usefulness", "tone", "reason", "rulesBroken"],
  additionalProperties: false,
} as const;

export type ClaudeGrade = {
  usefulness: number;
  tone: number;
  reason: string;
  // 0–100.
  score: number;
};

export type Usage = { model: string; inputTokens: number; outputTokens: number };

export type GradeInput = {
  question: string;
  earlier: readonly { role: "user" | "assistant"; content: string }[];
  answer: string;
  buttons: readonly string[];
  facts: Facts;
  // The scenario's own rules for the judge.
  rules?: { mustDo?: string[]; mustNot?: string[] };
};

// Null when Claude couldn't grade it (an error, a refusal, bad output).
export async function gradeWithClaude(
  input: GradeInput,
  claude: () => Pick<Anthropic, "messages">,
): Promise<{ grade: ClaudeGrade | null; usage: Usage | null }> {
  const model = process.env.ANTHROPIC_GRADER_MODEL || GRADER_MODEL;
  const content = JSON.stringify({
    conversation: input.earlier,
    question: input.question,
    answer: input.answer,
    buttons: input.buttons,
    ...(input.rules
      ? { rules: { mustDo: input.rules.mustDo ?? [], mustNot: input.rules.mustNot ?? [] } }
      : {}),
    numbers: {
      today: input.facts.asOf,
      safeToSpend: input.facts.safeCents,
      nextPayday: input.facts.payday,
      openFindings: input.facts.findings.map((f) => f.title),
      // What the person pays on a schedule, and every dollar figure Jane's own lookups gave
      // for this person: a figure in the answer that is in this list is not invented.
      recurring: input.facts.recurring.map(
        (r) =>
          `${r.merchant}: ${formatCents(r.lastCents)} last charge, ${formatCents(r.yearCents)} a year`,
      ),
      figuresFromTheirData: [
        ...new Set(input.facts.allowedCents.map((c) => formatCents(Math.abs(c)))),
      ].slice(0, 400),
    },
  });
  let response: Anthropic.Message;
  try {
    response = await claude().messages.create({
      model,
      max_tokens: 16000,
      system: [{ type: "text", text: RUBRIC, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
  } catch (error) {
    if (!(error instanceof Anthropic.APIError)) throw error;
    console.error("Answer check grading failed", { status: error.status });
    return { grade: null, usage: null };
  }
  const usage: Usage = {
    model,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
  const text = finishedText(response);
  if (!text) return { grade: null, usage };
  try {
    const parsed = JSON.parse(text) as {
      usefulness: unknown;
      tone: unknown;
      reason: unknown;
      rulesBroken?: unknown;
    };
    const usefulness = Number(parsed.usefulness);
    const tone = Number(parsed.tone);
    if (![usefulness, tone].every((n) => Number.isInteger(n) && n >= 1 && n <= 5)) {
      return { grade: null, usage };
    }
    // A rule broken fails the answer, however well it reads.
    const broken = (Array.isArray(parsed.rulesBroken) ? parsed.rulesBroken : [])
      .map((r) => String(r).slice(0, 120))
      .filter(Boolean)
      .slice(0, 5);
    const score = Math.round(((usefulness + tone - 2) / 8) * 100);
    return {
      grade: {
        usefulness,
        tone,
        reason:
          `${broken.length > 0 ? `Broke: ${broken.join("; ")}. ` : ""}${String(parsed.reason ?? "")}`.slice(
            0,
            400,
          ),
        // 1–5 each, to 0–100 together.
        score: broken.length > 0 ? Math.min(score, 50) : score,
      },
      usage,
    };
  } catch {
    return { grade: null, usage };
  }
}
