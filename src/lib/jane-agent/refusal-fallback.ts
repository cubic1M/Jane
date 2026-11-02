import type Anthropic from "@anthropic-ai/sdk";

// The server-side refusal fallback for Jane's chat (founder 11-01): when a safety classifier
// declines a chat request, the API runs the same request on another model in the same call, so
// the person still gets Claude's answer. From Anthropic's docs: `fallbacks: "default"` with the
// beta header server-side-fallback-2026-07-01, on the Claude API only; on Claude Sonnet 5.5 it
// retries "cyber" and "frontier_llm" declines on Claude Sonnet 5 (not "bio",
// "reasoning_extraction" or "general_harms": claude.ts asks once more itself for those). On a
// stream the switch happens on the same stream: a `fallback` block marks it in `content`, and
// `usage.iterations` has one entry per attempt (the declined one too).
//
// On unless CHAT_REFUSAL_FALLBACK is "off". If the API ever rejects it (a 400 that a retry
// without it doesn't get), it stays off on this server until it restarts.

export const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";

// The models the docs give the "default" form for.
const SUPPORTED = new Set([
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-fable-5-1",
  "claude-fable-5",
]);

let rejected = false;

export function refusalFallbackOn(model: string): boolean {
  const flag = (process.env.CHAT_REFUSAL_FALLBACK ?? "").trim().toLowerCase();
  if (flag === "off" || flag === "0" || flag === "false") return false;
  return !rejected && SUPPORTED.has(model);
}

// The API said no to it: off for this server instance (or back on, when the retry without it
// failed the same way and so it wasn't the cause).
export function setRefusalFallbackRejected(value: boolean): void {
  rejected = value;
}

// The request body with the fallback, and the header that turns it on.
export function withRefusalFallback(
  body: Anthropic.MessageStreamParams,
  on: boolean,
): [Anthropic.MessageStreamParams, { headers: Record<string, string> } | undefined] {
  if (!on) return [body, undefined];
  return [
    { ...body, fallbacks: "default" } as Anthropic.MessageStreamParams,
    { headers: { "anthropic-beta": REFUSAL_FALLBACK_BETA } },
  ];
}

type Block = { type: string };

// What of a response is the answer to run and send back: before the last switch, the declined
// model's thinking and tool calls are dropped (the docs: they're not echoed after a fallback, and
// its half-written tool calls are never run); its text and the `fallback` marker stay.
export function afterFallback<T extends Block>(content: readonly T[]): T[] {
  const last = content.findLastIndex((b) => b.type === "fallback");
  if (last < 0) return [...content];
  const dropped = new Set(["thinking", "redacted_thinking", "tool_use", "server_tool_use"]);
  return content.filter((b, i) => i > last || !dropped.has(b.type));
}

// The text of a response. Text blocks are separate lines, except across a fallback, where the
// fallback model carries on the declined model's sentence.
export function textOf(content: readonly Block[]): string {
  let text = "";
  let joined = true;
  for (const block of content) {
    if (block.type === "fallback") {
      joined = true;
      continue;
    }
    if (block.type !== "text") continue;
    const part = (block as Block & { text: string }).text;
    text += text && !joined ? `\n${part}` : part;
    joined = false;
  }
  return text.trim();
}

type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  iterations?: ({ type?: string; model?: string } & Usage)[] | null;
};

export type UsedTokens = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

// What each attempt used: `usage.iterations` is the per-attempt record when it's there (top-level
// usage is only the attempt that answered), else the top-level usage on the requested model.
export function usageOf(usage: Usage | undefined | null, model: string): UsedTokens[] {
  const read = (u: Usage, m: string): UsedTokens => ({
    model: m,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  });
  const attempts = (usage?.iterations ?? []).filter((u) => typeof u.input_tokens === "number");
  if (attempts.length > 0) return attempts.map((u) => read(u, u.model ?? model));
  return [read(usage ?? {}, model)];
}

// Whether another model answered (for the timing line).
export function servedByFallback(usage: Usage | undefined | null): boolean {
  return (usage?.iterations ?? []).some((u) => u.type === "fallback_message");
}
