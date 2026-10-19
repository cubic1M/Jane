import Anthropic from "@anthropic-ai/sdk";
import { finishedText, llmModel } from "@/lib/anthropic";
import type { Facts } from "./facts";

// Claude's grade for one of Jane's answers (spec step 87), against a written rubric for what
// the fixed checks can't see: is it useful, and does it sound like Jane. Only with an
// Anthropic key; the runner counts what it costs.

export const GRADER_VERSION = "grader-v1";

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

Never reward investment, tax or legal advice. Give a reason of one or two sentences naming what to fix.`;

const SCHEMA = {
  type: "object",
  properties: {
    usefulness: { type: "integer", enum: [1, 2, 3, 4, 5] },
    tone: { type: "integer", enum: [1, 2, 3, 4, 5] },
    reason: { type: "string" },
  },
  required: ["usefulness", "tone", "reason"],
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
};

// Null when Claude couldn't grade it (an error, a refusal, bad output).
export async function gradeWithClaude(
  input: GradeInput,
  claude: () => Pick<Anthropic, "messages">,
): Promise<{ grade: ClaudeGrade | null; usage: Usage | null }> {
  const model = llmModel();
  const content = JSON.stringify({
    conversation: input.earlier,
    question: input.question,
    answer: input.answer,
    buttons: input.buttons,
    numbers: {
      today: input.facts.asOf,
      safeToSpend: input.facts.safeCents,
      nextPayday: input.facts.payday,
      openFindings: input.facts.findings.map((f) => f.title),
    },
  });
  let response: Anthropic.Message;
  try {
    response = await claude().messages.create({
      model,
      max_tokens: 16000,
      system: [{ type: "text", text: RUBRIC, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
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
    const parsed = JSON.parse(text) as { usefulness: unknown; tone: unknown; reason: unknown };
    const usefulness = Number(parsed.usefulness);
    const tone = Number(parsed.tone);
    if (![usefulness, tone].every((n) => Number.isInteger(n) && n >= 1 && n <= 5)) {
      return { grade: null, usage };
    }
    return {
      grade: {
        usefulness,
        tone,
        reason: String(parsed.reason ?? "").slice(0, 400),
        // 1–5 each, to 0–100 together.
        score: Math.round(((usefulness + tone - 2) / 8) * 100),
      },
      usage,
    };
  } catch {
    return { grade: null, usage };
  }
}
