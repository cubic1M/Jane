import { CLAUDE_CALL_RETRIES, CLAUDE_CALL_TIMEOUT_MS } from "@/config/outside-calls";
import Anthropic from "@anthropic-ai/sdk";
import { killed } from "@/config/kill-switches";
import { freshSwitches } from "@/lib/ops-switches";
import { redactRequestBody } from "@/lib/person-payees";

// One shared client for the explanation and subscription calls. Everything that calls
// Claude must work without a key too: callers check llmEnabled() and fall back.

const DEFAULT_MODEL = "claude-opus-5-5";
// Jane's chat answers while the person waits, so it uses a faster model than the rest.
const DEFAULT_CHAT_MODEL = "claude-sonnet-5-5";

let client: Anthropic | undefined;

export function llmEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && !killed("claude");
}

export function llmModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

// The model for Jane's chat (src/lib/jane-agent/claude.ts).
export function chatModel(): string {
  return process.env.ANTHROPIC_CHAT_MODEL || DEFAULT_CHAT_MODEL;
}

// Every request to Claude's last step, so the store's switch holds whichever path made it, and so
// no path sends a person's name from a payment app's merchant text (src/lib/person-payees.ts).
export const claudeFetch: typeof fetch = async (input, init) => {
  await freshSwitches();
  if (killed("claude")) throw new Error("Claude is paused (KILL_CLAUDE)");
  if (typeof init?.body !== "string") return fetch(input, init);
  const body = redactRequestBody(init.body);
  if (body === init.body) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.delete("content-length");
  return fetch(input, { ...init, body, headers });
};

export function anthropic(): Anthropic {
  // For a caller that didn't check llmEnabled() first: it fails rather than reaching Claude.
  if (killed("claude")) throw new Error("Claude is paused (KILL_CLAUDE)");
  client ??= new Anthropic({
    fetch: claudeFetch,
    timeout: CLAUDE_CALL_TIMEOUT_MS,
    maxRetries: CLAUDE_CALL_RETRIES,
  });
  return client;
}

export function resetAnthropicForTests(): void {
  client = undefined;
}

// The text of a finished JSON answer, or null when Claude stopped early or refused.
export function finishedText(response: Anthropic.Message): string | null {
  if (response.stop_reason !== "end_turn") return null;
  const block = response.content.find((b) => b.type === "text");
  return block?.type === "text" ? block.text : null;
}
