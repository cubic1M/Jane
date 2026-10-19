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
  isAdvice,
  unsupportedFigures,
  type GuardrailIssue,
} from "@/lib/guardrails";
import { DEBT_TOOL_STATUS } from "./debt-tools";
import { CHAT_TOOLS, chatPrimer, proposeAction, runChatTool, type Proposal } from "./claude-tools";
import { GuardedText } from "./guarded-text";
import { INVESTMENT_TOOL_STATUS } from "./investments/tools";
import type { Reply } from "./replies";

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

export const CHAT_PROMPT_VERSION = "chat-v5";

// The one rule that differs in demo advice mode (spec step 98).
const NO_ADVICE = `- Never give investment, tax or legal advice, and don't mention investments, taxes or legal matters at all. Don't suggest financial products beyond Jane's pick from finding_details.`;
const DEMO_ADVICE = `- This person is using the demo bank with sample data, so you may recommend what to do about investments, taxes, insurance and loans: say what you'd do and why, from their numbers. Never promise a result or a return, and never give legal advice. The app labels your answer as demo advice; don't add a label or disclaimer yourself.`;

const SYSTEM = `You are Jane, the money helper inside a personal finance app, answering in the app's chat. You know the person's own money: spending, bills, subscriptions, safe to spend, goals, budgets, and what the app has found or is doing for them.

Be useful, like a friend who's good with money and has their numbers in front of them:
- Answer the actual question, with their figures. When they ask what to do about a subscription, a bill, a fee, a charge or their spending ("should I cancel Netflix?"), give your honest suggestion and the reason in a sentence or two: what it costs, what changed, what they'd save, and what you'd do. For example: "Netflix went up from $A to $B a month, which is $C a year. If you're not watching much, I'd cancel it, or switch to the cheaper plan I found. Tap Yes and I'll take care of it." (with their real amounts in place of $A, $B and $C)
- Before suggesting what to do about something the app found, look at finding_details for it. Use subscriptions for what they pay on a schedule.
- If they push back ("you tell me"), give a straight answer from their numbers. Don't repeat yourself or hand it back to them.
- Every answer must stand on its own. A button is extra: never answer with only a button or "tap the button".

Shape every answer the same way (spec step 89):
- The first sentence is the answer itself, with their figure: "Netflix is $17.99 a month." or "Yes: you'd still have $2,276.12 safe to spend until Oct 28 (in 10 days)." Never open with a lead-in ("Here's what I found:", "Sure!", "Great question") or restate the question.
- Then the reason, in a sentence or two, with their figures.
- Then one suggestion: the one that would save them the most, with its button (propose_action). A short list only when they ask to compare or for several things.
- Money as "$17.99 a month" or "$215.88 a year", never "/mo" or "per month". Dates as "Oct 28 (in 3 days)".
- Warm and brief: no filler, no apologies, no sign-off.

How to answer:
- Their main numbers right now come after these instructions. Answer from them when you can; use the tools for anything else. Never guess. If neither has it, say so plainly.
- Use only dollar amounts that appear in those numbers or in tool results, written exactly as they appear there (with the cents). Don't add, subtract, round or estimate amounts yourself.
- Keep it short: a few sentences or a short list. Plain words, no jargon, no headings. Don't write anything before a lookup; just look it up.
- You can't do anything yourself. When something can be done (cancel or lower something the app found, approve the plan, start a goal), call propose_action once so they get a button, and say what tapping it does. Never say it's done.
- Savings are estimates: say "could save" or "about", never "will save" or "definitely".
${NO_ADVICE}
- To "hi" or "thanks", answer in a sentence and mention one useful thing from their numbers.
- If a question isn't about their money in this app, say briefly what you can help with.`;
const SYSTEM_DEMO_ADVICE = SYSTEM.replace(NO_ADVICE, DEMO_ADVICE);

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
  // Demo advice mode (src/lib/advice-mode.ts, spec step 98): the demo guardrail profile,
  // and advice labelled. Off unless the caller checked adviceMode.
  advice?: boolean;
};

const STATUS: Record<string, string> = {
  // Loans and debt (spec Phase Y, ./debt-tools.ts).
  ...DEBT_TOOL_STATUS,
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
  finding_details: "Looking into it…",
  subscriptions: "Checking your subscriptions…",
  recent_changes: "Looking at what changed…",
  life_events: "Looking at your checklists…",
  plan_upkeep: "Looking at your week…",
  proven_savings: "Adding up what I saved you…",
  autopilot_settings: "Checking what I may do by myself…",
  propose_action: "Getting a button ready…",
};
export const statusFor = (tool: string) =>
  STATUS[tool] ?? INVESTMENT_TOOL_STATUS[tool] ?? "Looking that up…";

// Shown when Claude can't answer (an error, a refusal, too many lookups).
// Spec step 89: no dead ends; the chat adds the closest things Jane can answer as buttons.
export const CHAT_UNAVAILABLE_TEXT =
  "I couldn't look into that just now. Tap one of these and I'll answer it right away.";

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
  advice: boolean,
): string {
  const reasons = issues.map((issue) => {
    switch (issue) {
      case "unsupported_dollar_figure":
        return `It has amounts that aren't in their numbers or the tool results: ${unsupportedFigures(text, allowedCents).join(", ")}. Use those amounts exactly as they appear there instead, or leave just that amount out.`;
      case "investment_advice":
        return "It mentions investing or investments. Leave that out.";
      case "tax_or_legal_advice":
        return advice
          ? "It gives legal advice. Leave that out."
          : "It mentions taxes or legal matters. Leave that out.";
      case "guaranteed_outcome":
        return 'It promises a result. Say "could" or "about" instead of "will", "definitely" or "guaranteed".';
      default:
        return "It's missing required wording.";
    }
  });
  return `(From the app, not the person.) That answer can't be shown yet:\n- ${reasons.join("\n- ")}\nWrite the whole answer again for the person: fix only those parts and keep the rest, your suggestion and the other figures included. Don't mention this note.`;
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
    advice = false,
  }: Options,
): Promise<ClaudeAnswer> {
  const profile = advice ? "demo_advice" : "standard";
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
    profile,
  );
  const system: Anthropic.TextBlockParam[] = [
    // The instructions and tools are the same for everyone in each mode, so they're cached.
    {
      type: "text",
      text: advice ? SYSTEM_DEMO_ADVICE : SYSTEM,
      cache_control: { type: "ephemeral" },
    },
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
    const check = checkGuardrails(text, allowedCents, undefined, profile);
    if (!check.ok && rewrites < CHAT_CLAUDE_REWRITES && turn + 1 < maxTurns) {
      // Once, Claude is told what can't be shown and answers again.
      rewrites += 1;
      draft.reset();
      onEvent({ type: "reset" });
      onEvent({ type: "status", text: "Checking my answer…" });
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: rewriteRequest(text, check.issues, allowedCents, advice),
      });
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
    const refs = proposal?.refs ?? {};
    return {
      kind: "answer",
      reply: {
        body: proposal?.line ? `${text}\n\n${proposal.line}` : text,
        actions: proposal?.actions ?? [],
        // Demo advice is always labelled (the chat shows DEMO_ADVICE_LABEL under it).
        refs: advice && isAdvice(text) ? { ...refs, advice: true } : refs,
      },
    };
  }
  // Too many rounds of lookups for one message.
  return unavailable();
}
