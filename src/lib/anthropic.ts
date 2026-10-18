import Anthropic from "@anthropic-ai/sdk";

// One shared client for the explanation and subscription calls. Everything that calls
// Claude must work without a key too: callers check llmEnabled() and fall back.

const DEFAULT_MODEL = "claude-opus-5-5";

let client: Anthropic | undefined;

export function llmEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function llmModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

export function anthropic(): Anthropic {
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
