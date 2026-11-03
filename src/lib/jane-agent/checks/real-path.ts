import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma/client";
import { resetAnthropicForTests } from "@/lib/anthropic";
import { dollarFigures } from "@/lib/guardrails";
import { formatCents } from "@/lib/money";
import { resetClaudeHealth } from "../claude";
import { sectorOf } from "../tool-select";
import { sendToJane, type AnswerSource } from "../typing";
import { QUESTIONS, type CheckQuestion } from "./bank";
import { systemDb } from "@/lib/system-db";

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

// How the played-back model behaves when it writes (11-03): the chat has to give the person
// Claude's own words whichever of these happens. "plain" just answers. The others refuse or write
// something the guardrails block, once or every time, or switch models mid-answer as the server-side
// fallback does.
export const ROUNDS = [
  "plain",
  "refused_first",
  "blocked_first",
  "switched_model",
  "refused_always",
  "blocked_always",
] as const;
export type RealPathRound = (typeof ROUNDS)[number];
// Claude never comes round in these, so the backup is right; anything else must end in Claude's words.
const NEVER_COMES_ROUND: readonly RealPathRound[] = ["refused_always", "blocked_always"];

// What must never be left in front of the person. Each trips one rule, on any account, so a rule
// that stops working can't hide behind another; the bank's questions take turns with them. A refused
// draft is taken back however harmless it reads.
const BLOCKED_DRAFTS = [
  "This is guaranteed to work for you.",
  "Verify at https://chase-verify.example/login to keep your account.",
  "Reply with your online banking password to confirm.",
  "Pay the fee with a gift card today.",
  "A refund of $9,999.00 is on its way to you.",
  "You could sue them over this.",
];
const REFUSED_DRAFT = "Let me start on that by looking at";
const NOT_SHOWN =
  /guaranteed to work|chase-verify|banking password|gift card|9,999|sue them|Let me start on that/i;

type Played = {
  toolResults: { content: string; isError: boolean }[];
  focus: string | null;
  // How many times it has written, and what the chat asked it on each later try.
  writes: number;
  asked: string[];
};
export const newPlayed = (): Played => ({ toolResults: [], focus: null, writes: 0, asked: [] });

const usage = { input_tokens: 0, output_tokens: 0 } as Anthropic.Usage;
const textBlock = (text: string) =>
  ({ type: "text", text, citations: null }) as Anthropic.TextBlock;
const wrote = (text: string): Partial<Anthropic.Message> => ({
  stop_reason: "end_turn",
  usage,
  content: [textBlock(text)],
});

function writing(
  round: RealPathRound,
  write: number,
  answer: string,
  questionId: string,
): Partial<Anthropic.Message> {
  const refused = (round === "refused_first" && write === 0) || round === "refused_always";
  if (refused) return { stop_reason: "refusal", usage, content: [textBlock(REFUSED_DRAFT)] };
  if ((round === "blocked_first" && write === 0) || round === "blocked_always") {
    const turn = [...questionId].reduce((sum, c) => sum + c.charCodeAt(0), 0);
    return wrote(BLOCKED_DRAFTS[turn % BLOCKED_DRAFTS.length]);
  }
  if (round === "switched_model") {
    const cut = answer.indexOf(" ", 8);
    return {
      stop_reason: "end_turn",
      usage,
      content: [
        textBlock(answer.slice(0, cut)),
        {
          type: "fallback",
          from: { model: "claude-sonnet-5-5" },
          to: { model: "claude-sonnet-5" },
          trigger: { type: "refusal" },
        } as unknown as Anthropic.TextBlock,
        textBlock(answer.slice(cut)),
      ],
    };
  }
  return wrote(answer);
}

// Claude, played back: the named tool, then a sentence with the first figure it returned.
export function playbackClaude(
  question: CheckQuestion,
  played: Played,
  round: RealPathRound = "plain",
) {
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
              usage,
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
            const answer = figure
              ? `I can see ${formatCents(figure.cents)} in your accounts for that.`
              : WORDS_WITHOUT_A_FIGURE;
            if (played.writes > 0) played.asked.push(JSON.stringify(params.messages.at(-1)));
            message = writing(round, played.writes, answer, question.id);
            played.writes += 1;
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
    rounds = ["plain"],
  }: {
    client: PrismaClient;
    now: Date;
    questions?: readonly CheckQuestion[];
    rounds?: readonly RealPathRound[];
  },
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
    for (const round of rounds) {
      for (const question of questions) {
        resetClaudeHealth();
        await systemDb("Rate limits are the system's own counters", client).rateLimit.deleteMany({
          where: { key: { in: [`chat:${userId}`, `ask:${userId}`, `chatspend:${userId}`] } },
        });
        const played = newPlayed();
        const failed: string[] = [];
        let source: AnswerSource | undefined;
        // What is on the person's screen: what streamed, less what was taken back.
        let screen = "";
        let body = "";
        try {
          const sent = await sendToJane(userId, question.text, {
            client,
            now: new Date(now.getTime() + (tick += 1000)),
            claude: playbackClaude(question, played, round),
            primerMs: 60_000,
            onEvent: (event) => {
              if (event.type === "text") screen += event.text;
              if (event.type === "reset") screen = "";
            },
          });
          source = sent.source;
          body = sent.reply.body;
          const mustComeRound = !NEVER_COMES_ROUND.includes(round);
          if (mustComeRound && source === "claude_blocked") failed.push("blocked");
          else if (mustComeRound && (source === "claude_unavailable" || source === "fallback")) {
            failed.push("fell_back");
          } else if (source === "capped") failed.push("capped");
          if (source === "claude" && !screen.trim()) failed.push("never_started");
          if (!body.trim()) failed.push("no_words");
          if (NOT_SHOWN.test(body) || NOT_SHOWN.test(screen)) failed.push("shown");
          if (round === "switched_model" && source === "claude" && played.writes !== 1) {
            failed.push("asked_again");
          }
          if ((round === "refused_first" || round === "blocked_first") && played.writes !== 2) {
            failed.push(played.writes < 2 ? "not_asked_again" : "asked_too_often");
          }
        } catch {
          failed.push("threw");
        }
        if (played.toolResults.some((r) => r.isError)) failed.push("tool_error");
        if (played.toolResults.some((r) => /^\{"error":"(?!There's no tool)/.test(r.content))) {
          failed.push("tool_said_error");
        }
        if (question.tool && !routedTo(played.focus, question.tool)) failed.push("not_routed");
        results.push({
          id: round === "plain" ? question.id : `${question.id}#${round}`,
          text: question.text,
          ok: failed.length === 0,
          failed,
          source,
          tool: question.tool,
        });
      }
    }
  } finally {
    if (keyBefore === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = keyBefore;
    if (capBefore === undefined) delete process.env.CHAT_MONTHLY_CAP_CENTS;
    else process.env.CHAT_MONTHLY_CAP_CENTS = capBefore;
    resetAnthropicForTests();
  }
  return summary(results);
}

function summary(results: RealPathResult[]): RealPathRun {
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

export function combinedRuns(...runs: readonly RealPathRun[]): RealPathRun {
  return summary(runs.flatMap((run) => run.results));
}
