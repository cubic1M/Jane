import Anthropic from "@anthropic-ai/sdk";
import { ASK_BLOCKED_REPLY, ASK_MAX_TOOL_ROUNDS, ASK_UNAVAILABLE_REPLY } from "@/config/ask";
import type { PrismaClient } from "@/generated/prisma/client";
import { anthropic, llmEnabled, llmModel } from "@/lib/anthropic";
import { checkGuardrails, dollarFigures, type GuardrailIssue } from "@/lib/guardrails";
import { ASK_TOOLS, runAskTool } from "./tools";

// One answer from Jane: Claude, the person's question, and read-only tools over their own
// data. The answer is only shown after the guardrails pass, and they only allow dollar
// figures that came from a tool result, the question, or an earlier vetted answer. So the
// answer is held until it's complete; while tools run, the person sees what Jane is doing.

export const ASK_PROMPT_VERSION = "ask-v1";

const SYSTEM = `You are Jane, a friendly helper inside a personal finance app. You answer the person's questions about their own money: spending, transactions, bills, and what the app has found or is doing for them.

- Use the tools to look things up. Never guess. If the tools don't have it, say so plainly.
- Use only dollar amounts that appear in tool results, written exactly as they appear there. Don't add, subtract or estimate amounts yourself; if you need a total, use a tool that returns one.
- Keep answers short: a sentence or two, or a short list. Plain words, no jargon.
- Never give investment, tax or legal advice, and never recommend a financial product. Never promise a result.
- If a question isn't about their money in this app, say briefly what you can help with.`;

export type HistoryMessage = { role: "user" | "assistant"; content: string };

export type AskResult =
  | { kind: "answer"; text: string }
  | { kind: "blocked"; text: string; issues: GuardrailIssue[] }
  | { kind: "unavailable"; text: string };

type Options = {
  client?: PrismaClient;
  now?: Date;
  claude?: () => Pick<Anthropic, "messages">;
  // Called with a short note each time Jane looks something up.
  onStatus?: (text: string) => void;
};

const STATUS: Record<string, string> = {
  search_transactions: "Searching your transactions…",
  spending_by_category: "Adding up your spending…",
  monthly_totals: "Looking at your months…",
  list_findings: "Checking what we've found…",
  list_actions: "Checking your actions…",
  upcoming_bills: "Looking at upcoming bills…",
};

export async function askJane(
  userId: string,
  history: HistoryMessage[],
  question: string,
  { client, now, claude = anthropic, onStatus = () => {} }: Options = {},
): Promise<AskResult> {
  if (!llmEnabled()) return { kind: "unavailable", text: ASK_UNAVAILABLE_REPLY };

  // Figures the answer may use: from tools, the question, and earlier (vetted) answers.
  const allowedCents = [question, ...history.map((m) => m.content)].flatMap((text) =>
    dollarFigures(text).map((f) => f.cents),
  );
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];

  for (let round = 0; round <= ASK_MAX_TOOL_ROUNDS; round += 1) {
    let response: Anthropic.Message;
    try {
      response = await claude().messages.create({
        model: llmModel(),
        max_tokens: 16000,
        system: SYSTEM,
        tools: ASK_TOOLS,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        messages,
      });
    } catch (error) {
      if (!(error instanceof Anthropic.APIError)) throw error;
      console.error("Ask Jane request failed", { status: error.status });
      return { kind: "unavailable", text: ASK_UNAVAILABLE_REPLY };
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        onStatus(STATUS[block.name] ?? "Looking that up…");
        const output = await runAskTool(userId, block.name, block.input, { client, now });
        allowedCents.push(...output.cents);
        results.push({ type: "tool_result", tool_use_id: block.id, content: output.content });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    if (response.stop_reason !== "end_turn") {
      return { kind: "unavailable", text: ASK_UNAVAILABLE_REPLY };
    }
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    if (!text) return { kind: "unavailable", text: ASK_UNAVAILABLE_REPLY };
    const check = checkGuardrails(text, allowedCents);
    return check.ok
      ? { kind: "answer", text }
      : { kind: "blocked", text: ASK_BLOCKED_REPLY, issues: check.issues };
  }
  // Too many lookups for one question.
  return { kind: "unavailable", text: ASK_UNAVAILABLE_REPLY };
}
