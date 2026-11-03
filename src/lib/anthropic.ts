import Anthropic from "@anthropic-ai/sdk";
import { killed } from "@/config/kill-switches";

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

export function anthropic(): Anthropic {
  // For a caller that didn't check llmEnabled() first: it fails rather than reaching Claude.
  if (killed("claude")) throw new Error("Claude is paused (KILL_CLAUDE)");
  client ??= new Anthropic();
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
