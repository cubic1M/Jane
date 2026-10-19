import Anthropic from "@anthropic-ai/sdk";
import {
  CHAT_CLAUDE_EFFORT,
  CHAT_CLAUDE_MAX_TURNS,
  CHAT_CLAUDE_REWRITES,
} from "@/config/agent-chat";
import { ASK_BLOCKED_REPLY } from "@/config/ask";
import type { PrismaClient } from "@/generated/prisma/client";
import { anthropic, chatModel } from "@/lib/anthropic";
import {
  checkGuardrails,
  dollarFigures,
  unsupportedFigures,
  type GuardrailIssue,
} from "@/lib/guardrails";
import { CHAT_TOOLS, chatPrimer, proposeAction, runChatTool, type Proposal } from "./claude-tools";
import { GuardedText } from "./guarded-text";
import { EXAMPLES, type Reply } from "./replies";

// Free questions in Jane's chat, with an Anthropic key (spec step 84): Claude, the
// person's recent typed messages and Jane's answers to them, and read-only tools over their
// own data, like Ask (src/lib/ask/answer.ts). Claude's text is only shown once it passes the
// guardrails, which allow only dollar figures from a tool, the question or an earlier
// answer. Claude can offer one button from the action registry (propose_action), never
// press it: the person taps.
//
// Quick by design: a faster model than the rest of the app (chatModel), little thinking,
// the person's main numbers sent with the question so most answers need no lookup, and
// the answer streamed as it's written (onEvent), a sentence at a time once each passes the
// guardrails (./guarded-text), with what Jane is looking up in between.

export const CHAT_PROMPT_VERSION = "chat-v3";

const SYSTEM = `You are Jane, a friendly helper inside a personal finance app, answering in the app's chat. You answer the person's questions about their own money: spending, bills, safe to spend, goals, budgets, and what the app has found or is doing for them.

- The person's main numbers right now come after these instructions. Answer from them when you can; use the tools only for anything else (a merchant, an earlier month, a search). Never guess. If neither has it, say so plainly.
- Use only dollar amounts that appear in those numbers or in tool results, written exactly as they appear there (with the cents). Don't add, subtract, round or estimate amounts yourself.
- Keep answers short: a sentence or two, or a short list. Plain words, no jargon, no headings. Don't write anything before a lookup; just look it up.
- You can't do anything yourself. When the person wants something done (cancel, lower a bill, approve, start a goal), call propose_action once so they get a button to tap, and say they can tap it. Never say it's done.
- When they ask "should I…" (cancel something, switch, spend), don't decide for them: give the facts that matter (what it costs, what you found, what they could save, written as "could save about"), say it's their call, and offer the button with propose_action when there is one.
- Never give investment, tax or legal advice, and never recommend a financial product. Don't mention investments, taxes or legal matters at all. Never promise a result: say "could", never "will" or "definitely".
- To "hi" or "thanks", answer in a sentence and mention one useful thing from their numbers.
- If a question isn't about their money in this app, say briefly what you can help with.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ClaudeAnswer =
  | { kind: "answer"; reply: Reply }
  | { kind: "blocked"; reply: Reply; issues: GuardrailIssue[] }
  | { kind: "unavailable"; reply: Reply };

// What the person sees while Jane answers: what she's doing, the answer so far, or
// "reset" when text so far turned out to lead into a lookup.
export type ChatStreamEvent =
  { type: "status"; text: string } | { type: "text"; text: string } | { type: "reset" };

type Options = {
  client: PrismaClient;
  now: Date;
  claude?: () => Pick<Anthropic, "messages">;
  maxTurns?: number;
  onEvent?: (event: ChatStreamEvent) => void;
};

const STATUS: Record<string, string> = {
  search_transactions: "Searching your transactions…",
  spending_by_category: "Adding up your spending…",
  monthly_totals: "Looking at your months…",
  upcoming_bills: "Looking at upcoming bills…",
  list_actions: "Checking your actions…",
  safe_to_spend: "Checking safe to spend…",
  coming_up: "Looking at what's coming up…",
  open_findings: "Checking what I've found…",
  goals: "Looking at your goals…",
  budgets: "Checking your budgets…",
  net_worth: "Adding up your net worth…",
  propose_action: "Getting a button ready…",
};
export const statusFor = (tool: string) => STATUS[tool] ?? "Looking that up…";

// Shown when Claude can't answer (an error, a refusal, too many lookups).
export const CHAT_UNAVAILABLE_TEXT = `I couldn't look into that just now. Try one of these:\n${EXAMPLES.map((e) => `- ${e}`).join("\n")}`;

const unavailable = (): ClaudeAnswer => ({
  kind: "unavailable",
  reply: { body: CHAT_UNAVAILABLE_TEXT, actions: [], refs: {} },
});

// The API wants the first message from the person, and one turn per side.
function conversation(history: ChatTurn[], question: string): Anthropic.MessageParam[] {
  const turns: ChatTurn[] = [];
  for (const turn of [...history, { role: "user" as const, content: question }]) {
    const last = turns.at(-1);
    if (!last && turn.role === "assistant") continue;
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${turn.content}`;
    else turns.push({ ...turn });
  }
  return turns.map((t) => ({ role: t.role, content: t.content }));
}

// What to fix, for one more try, in the words of the rules above.
function rewriteRequest(
  text: string,
  issues: GuardrailIssue[],
  allowedCents: readonly number[],
): string {
  const reasons = issues.map((issue) => {
    switch (issue) {
      case "unsupported_dollar_figure":
        return `It has amounts that aren't in their numbers or the tool results: ${unsupportedFigures(text, allowedCents).join(", ")}. Use only amounts exactly as they appear there, or leave the amount out.`;
      case "investment_advice":
        return "It mentions investing or investments. Leave that out.";
      case "tax_or_legal_advice":
        return "It mentions taxes or legal matters. Leave that out.";
      case "guaranteed_outcome":
        return 'It promises a result. Say "could" or "about" instead of "will", "definitely" or "guaranteed".';
      default:
        return "It's missing required wording.";
    }
  });
  return `(From the app, not the person.) That answer can't be shown yet:\n- ${reasons.join("\n- ")}\nWrite the whole answer again for the person, fixed. Don't mention this note.`;
}

export async function askClaudeInChat(
  userId: string,
  history: ChatTurn[],
  question: string,
  {
    client,
    now,
    claude = anthropic,
    maxTurns = CHAT_CLAUDE_MAX_TURNS,
    onEvent = () => {},
  }: Options,
): Promise<ClaudeAnswer> {
  onEvent({ type: "status", text: "Looking at your numbers…" });
  const primer = await chatPrimer(userId, { client, now });
  // Figures the answer may use: any in the numbers sent up front or a tool's result (a
  // finding's title has some too: "Charged twice? $64.20 at Target"), the question, and
  // earlier answers.
  const allowedCents = [question, primer.text, ...history.map((m) => m.content)].flatMap((text) =>
    dollarFigures(text).map((f) => f.cents),
  );
  allowedCents.push(...primer.cents);
  let rewrites = 0;
  const messages = conversation(history, question);
  let proposal: Extract<Proposal, { ok: true }> | null = null;
  const draft = new GuardedText(
    () => allowedCents,
    (text) => onEvent({ type: "text", text }),
  );
  const system: Anthropic.TextBlockParam[] = [
    // The instructions and tools are the same for everyone, so they're cached.
    { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: `The person's numbers right now (today is ${now.toISOString().slice(0, 10)}):\n${primer.text || "None available."}`,
    },
  ];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    let response: Anthropic.Message;
    try {
      const stream = claude()
        .messages.stream({
          model: chatModel(),
          max_tokens: 16000,
          system,
          tools: CHAT_TOOLS,
          thinking: { type: "adaptive" },
          output_config: { effort: CHAT_CLAUDE_EFFORT },
          messages,
        })
        .on("streamEvent", (event) => {
          if (event.type !== "content_block_start") return;
          if (event.content_block.type === "thinking") {
            onEvent({ type: "status", text: "Thinking…" });
          }
          if (event.content_block.type === "tool_use") {
            onEvent({ type: "status", text: statusFor(event.content_block.name) });
          }
        })
        .on("text", (delta) => draft.push(delta));
      response = await stream.finalMessage();
    } catch (error) {
      if (!(error instanceof Anthropic.APIError)) throw error;
      console.error("Jane's chat request to Claude failed", { status: error.status });
      return unavailable();
    }

    if (response.stop_reason === "tool_use") {
      // Any text so far led into the lookup; the answer comes after it.
      draft.reset();
      onEvent({ type: "reset" });
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        if (block.name === "propose_action") {
          const result: Proposal = proposal
            ? { ok: false, error: "You already offered a button for this answer." }
            : await proposeAction(userId, block.input, { client, now });
          if (result.ok) proposal = result;
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result.ok ? "The button will be shown under your answer." : result.error,
            ...(result.ok ? {} : { is_error: true }),
          });
          continue;
        }
        const output = await runChatTool(userId, block.name, block.input, { client, now });
        allowedCents.push(...output.cents, ...dollarFigures(output.content).map((f) => f.cents));
        results.push({ type: "tool_result", tool_use_id: block.id, content: output.content });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    if (response.stop_reason !== "end_turn") return unavailable();
    draft.finish();
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    if (!text) return unavailable();
    const check = checkGuardrails(text, allowedCents);
    if (!check.ok && rewrites < CHAT_CLAUDE_REWRITES && turn + 1 < maxTurns) {
      // Once, Claude is told what can't be shown and answers again.
      rewrites += 1;
      draft.reset();
      onEvent({ type: "reset" });
      onEvent({ type: "status", text: "Checking my answer…" });
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: rewriteRequest(text, check.issues, allowedCents) });
      continue;
    }
    if (!check.ok) {
      // The issues only, never the text: it's about the person's money.
      console.warn("Jane's chat answer was blocked by the guardrails", { issues: check.issues });
      // A safe fallback, with no buttons.
      return {
        kind: "blocked",
        reply: { body: ASK_BLOCKED_REPLY, actions: [], refs: {} },
        issues: check.issues,
      };
    }
    return {
      kind: "answer",
      reply: {
        body: proposal?.line ? `${text}\n\n${proposal.line}` : text,
        actions: proposal?.actions ?? [],
        refs: proposal?.refs ?? {},
      },
    };
  }
  // Too many rounds of lookups for one message.
  return unavailable();
}
