import Anthropic from "@anthropic-ai/sdk";
import { NEWS_MAX_OUTPUT_TOKENS, NEWS_SUMMARY_MAX_CHARS } from "@/config/news";
import { anthropic, finishedText } from "@/lib/anthropic";
import { checkGuardrails, dollarFigures, predictsAPrice } from "@/lib/guardrails";
import type { Headline } from "@/lib/market";

// One-sentence summaries of headlines (spec step 293). Claude writes them only when the news
// model is set (newsLlmEnabled); otherwise, and whenever Claude's sentence fails the checks, the
// rules write one from the headline's own words. Every summary, whoever wrote it, passes the
// demo_advice guardrail and never predicts a price.

export function newsModel(env: Record<string, string | undefined> = process.env): string | null {
  return env.ANTHROPIC_MODEL_NEWS?.trim() || null;
}

// Off unless both the key and the news model are set.
export function newsLlmEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY) && newsModel(env) !== null;
}

// Whether a summary may be shown: it passes the demo_advice guardrail with only the headline's
// own dollar figures, predicts no price, and is one short line.
export function summaryOk(summary: string, headline: Pick<Headline, "title">): boolean {
  const text = summary.trim();
  if (text.length === 0 || text.length > NEWS_SUMMARY_MAX_CHARS) return false;
  if (predictsAPrice(text)) return false;
  const allowed = dollarFigures(headline.title).map((f) => f.cents);
  return checkGuardrails(text, allowed, undefined, "demo_advice").ok;
}

const subjectOf = (h: Pick<Headline, "ticker">) => (h.ticker ? h.ticker : "Markets");

// The rules summary: the headline's own words as a sentence, after who it is about. When even
// that fails the checks (a headline that forecasts a price), it says only that there was news.
export function rulesSummary(h: Pick<Headline, "ticker" | "title" | "source" | "date">): string {
  let words = h.title
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*/g, ", and ")
    .replace(/\s*[.!?]+$/, "")
    .trim();
  const room = NEWS_SUMMARY_MAX_CHARS - subjectOf(h).length - 3;
  if (words.length > room) words = `${words.slice(0, room - 1).replace(/\s+\S*$/, "")}…`;
  const sentence = `${subjectOf(h)}: ${words}.`;
  if (summaryOk(sentence, h)) return sentence;
  return `${subjectOf(h)}: a news item from ${h.source} on ${h.date}; see the headline.`;
}

// What Claude is told. Facts from the headline only: no forecasts, no advice, no new figures.
export const NEWS_SYSTEM = `You summarise financial news headlines for a practice (paper money) portfolio that uses sample data.
For each headline, write one plain sentence of at most ${NEWS_SUMMARY_MAX_CHARS} characters that says what happened, using only facts in the headline itself.
Rules:
- Never predict or hint where a price, a stock or the market is going (no "could rise", "may fall", "expected to rebound", price targets).
- Never say whether to buy, sell or hold anything, and never give tax or legal advice.
- Never add a number, an amount or a date that isn't in the headline. Never promise anything.
- Start with the ticker (or "Markets" when there is none) and a colon.
Return one summary per headline id.`;

export const NEWS_SCHEMA = {
  type: "object",
  properties: {
    summaries: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, summary: { type: "string" } },
        required: ["id", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["summaries"],
  additionalProperties: false,
};

export type BatchUsage = { inputTokens: number; outputTokens: number };
export type BatchResult = { summaries: Map<string, string>; usage: BatchUsage };

// Reads Claude's answer: the summaries for the ids asked about, nothing else. A recorded response
// is checked against this in the contract tests.
export function parseBatch(response: Anthropic.Message, asked: readonly string[]): BatchResult {
  const usage = {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
  const summaries = new Map<string, string>();
  const text = finishedText(response);
  if (text === null) return { summaries, usage };
  let parsed: { summaries?: { id?: unknown; summary?: unknown }[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { summaries, usage };
  }
  const wanted = new Set(asked);
  for (const item of parsed.summaries ?? []) {
    if (typeof item.id === "string" && typeof item.summary === "string" && wanted.has(item.id)) {
      summaries.set(item.id, item.summary.trim());
    }
  }
  return { summaries, usage };
}

// One batched call. The ids are the batch's positions ("h1", "h2", ...), so a long feed id is
// never sent and nothing is matched by headline text.
export type Summarizer = (batch: readonly Headline[], model: string) => Promise<BatchResult>;

export const batchIds = (batch: readonly Headline[]) => batch.map((_, i) => `h${i + 1}`);

export const claudeSummarizer: Summarizer = async (batch, model) => {
  const ids = batchIds(batch);
  const response = await anthropic().messages.create({
    model,
    max_tokens: NEWS_MAX_OUTPUT_TOKENS,
    system: NEWS_SYSTEM,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          headlines: batch.map((h, i) => ({
            id: ids[i],
            ticker: h.ticker,
            date: h.date,
            title: h.title,
          })),
        }),
      },
    ],
    output_config: { effort: "low", format: { type: "json_schema", schema: NEWS_SCHEMA } },
  });
  return parseBatch(response, ids);
};

export const isApiError = (error: unknown) => error instanceof Anthropic.APIError;
