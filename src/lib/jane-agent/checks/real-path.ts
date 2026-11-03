import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma/client";
import { resetAnthropicForTests } from "@/lib/anthropic";
import { dollarFigures } from "@/lib/guardrails";
import { formatCents } from "@/lib/money";
import { resetClaudeHealth } from "../claude";
import { sectorOf } from "../tool-select";
import { sendToJane, type AnswerSource } from "../typing";
import { QUESTIONS, type CheckQuestion } from "./bank";

// Plan item 13: the free nightly check of the way people are really answered. Claude answers all
// typed text, so the rules-only score says little about what they read: its 100 comes from the
// backup. Here every question in the bank goes through the real chat, with the real primer, tool
// routing, tools, guardrails and streaming, and only the model is played back: it calls the tool
// the question should reach and says a figure that tool returned. So it can't tell whether an
// answer is good (that takes Claude, by hand). It tells whether the path works: a tool that throws
// or errors on a real person, a question routed away from its tool, a tool's own figure blocked by
// the guardrails, or an answer that falls back or never starts.

export type RealPathResult = {
  id: string;
  text: string;
  ok: boolean;
  // What went wrong, by name.
  failed: string[];
  source?: AnswerSource;
  tool?: string;
};

export type RealPathRun = {
  mode: "real_path";
  score: number;
  asked: number;
  failures: Record<string, number>;
  results: RealPathResult[];
};

// These need an id or a choice Claude takes from the person's numbers. Played back with a made-up
// one they rightly refuse, which says nothing about the path: injection.test.ts covers the refusals.
const NEEDS_A_REAL_CHOICE = new Set(["propose_action", "finding_details", "show_block"]);

const WORDS_WITHOUT_A_FIGURE = "Here is what I can see in your accounts.";

// The input a tool needs from its schema: the first choice of anything required.
function inputFor(tool: Anthropic.Tool | undefined): Record<string, unknown> {
  const schema = tool?.input_schema as
    | {
        required?: string[];
        properties?: Record<string, { type?: string; enum?: unknown[] }>;
      }
    | undefined;
  return Object.fromEntries(
    (schema?.required ?? []).map((key) => {
      const property = schema?.properties?.[key];
      if (property?.enum?.length) return [key, property.enum[0]];
      return [key, property?.type === "number" ? 1 : "groceries"];
    }),
  );
}

type Played = { toolResults: { content: string; isError: boolean }[]; focus: string | null };

// Claude, played back: the named tool, then a sentence with the first figure it returned.
export function playbackClaude(question: CheckQuestion, played: Played) {
  return () =>
    ({
      messages: {
        stream: (params: Anthropic.MessageStreamParams) => {
          const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
          const system = JSON.stringify(params.system ?? "");
          played.focus ??= /This question is about ([^.]*)\./.exec(system)?.[1] ?? null;
          const results = params.messages.flatMap((m) =>
            Array.isArray(m.content)
              ? m.content.filter(
                  (b): b is Anthropic.ToolResultBlockParam => b.type === "tool_result",
                )
              : [],
          );
          const tool = (params.tools as Anthropic.Tool[] | undefined)?.find(
            (t) => t.name === question.tool && !NEEDS_A_REAL_CHOICE.has(t.name),
          );
          let message: Partial<Anthropic.Message>;
          if (tool && results.length === 0) {
            message = {
              stop_reason: "tool_use",
              usage: { input_tokens: 0, output_tokens: 0 } as Anthropic.Usage,
              content: [
                {
                  type: "tool_use",
                  id: "played",
                  name: tool.name,
                  input: inputFor(tool),
                } as Anthropic.ToolUseBlock,
              ],
            };
          } else {
            played.toolResults = results.map((r) => ({
              content: String(r.content ?? ""),
              isError: r.is_error === true,
            }));
            const figure = results.flatMap((r) => dollarFigures(String(r.content ?? "")))[0];
            const text = figure
              ? `I can see ${formatCents(figure.cents)} in your accounts for that.`
              : WORDS_WITHOUT_A_FIGURE;
            message = {
              stop_reason: "end_turn",
              usage: { input_tokens: 0, output_tokens: 0 } as Anthropic.Usage,
              content: [{ type: "text", text, citations: null } as Anthropic.TextBlock],
            };
          }
          const stream = {
            on(name: string, fn: (...args: unknown[]) => void) {
              (listeners[name] ??= []).push(fn);
              return stream;
            },
            async finalMessage() {
              for (const block of message.content ?? []) {
                for (const fn of listeners.streamEvent ?? []) {
                  fn({ type: "content_block_start", content_block: block });
                }
                if (block.type === "text") for (const fn of listeners.text ?? []) fn(block.text);
              }
              return message;
            },
          };
          return stream;
        },
      },
    }) as unknown as Anthropic;
}

const routedTo = (focus: string | null, tool: string) => {
  const sector = sectorOf(tool);
  if (sector === null || !focus || focus.startsWith("no one area")) return true;
  return focus.includes(sector);
};

export async function runRealPath(
  userId: string,
  {
    client,
    now,
    questions = QUESTIONS,
  }: { client: PrismaClient; now: Date; questions?: readonly CheckQuestion[] },
): Promise<RealPathRun> {
  // The chat only asks Claude when there's a key. This one is never sent: nothing here reaches the
  // API, since sendToJane is handed the played-back model, and it's gone again afterwards.
  const keyBefore = process.env.ANTHROPIC_API_KEY;
  const capBefore = process.env.CHAT_MONTHLY_CAP_CENTS;
  process.env.ANTHROPIC_API_KEY = keyBefore || "played-back";
  process.env.CHAT_MONTHLY_CAP_CENTS = "1000000000";
  const results: RealPathResult[] = [];
  let tick = 0;
  try {
    for (const question of questions) {
      resetClaudeHealth();
      await client.rateLimit.deleteMany({
        where: { key: { in: [`chat:${userId}`, `ask:${userId}`, `chatspend:${userId}`] } },
      });
      const played: Played = { toolResults: [], focus: null };
      const failed: string[] = [];
      let source: AnswerSource | undefined;
      let spoke = false;
      try {
        const sent = await sendToJane(userId, question.text, {
          client,
          now: new Date(now.getTime() + (tick += 1000)),
          claude: playbackClaude(question, played),
          primerMs: 60_000,
          onEvent: (event) => {
            if (event.type === "text") spoke = true;
          },
        });
        source = sent.source;
        if (source === "claude_blocked") failed.push("blocked");
        else if (source === "claude_unavailable" || source === "fallback") failed.push("fell_back");
        else if (source === "capped") failed.push("capped");
        if (source === "claude" && !spoke) failed.push("never_started");
        if (!sent.reply.body.trim()) failed.push("no_words");
      } catch {
        failed.push("threw");
      }
      if (played.toolResults.some((r) => r.isError)) failed.push("tool_error");
      if (played.toolResults.some((r) => /^\{"error":"(?!There's no tool)/.test(r.content))) {
        failed.push("tool_said_error");
      }
      if (question.tool && !routedTo(played.focus, question.tool)) failed.push("not_routed");
      results.push({
        id: question.id,
        text: question.text,
        ok: failed.length === 0,
        failed,
        source,
        tool: question.tool,
      });
    }
  } finally {
    if (keyBefore === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = keyBefore;
    if (capBefore === undefined) delete process.env.CHAT_MONTHLY_CAP_CENTS;
    else process.env.CHAT_MONTHLY_CAP_CENTS = capBefore;
    resetAnthropicForTests();
  }
  const failures: Record<string, number> = {};
  for (const r of results) for (const f of r.failed) failures[f] = (failures[f] ?? 0) + 1;
  return {
    mode: "real_path",
    score: results.length
      ? Math.round((100 * results.filter((r) => r.ok).length) / results.length)
      : 0,
    asked: results.length,
    failures,
    results,
  };
}
