import {
  CLAUDE_CALL_RETRIES,
  CLAUDE_CALL_TIMEOUT_MS,
  CLAUDE_REFUSED_PAUSE_MS,
  CLAUDE_REFUSED_PROBE_MS,
} from "@/config/outside-calls";
import Anthropic from "@anthropic-ai/sdk";
import { killed } from "@/config/kill-switches";
import { freshSwitches } from "@/lib/ops-switches";
import { recordOpsEvent } from "@/lib/ops-alerts";
import { log } from "@/lib/log";
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

// Every request to Claude's last step, so the store's switch holds whichever path made it, so no
// path sends a person's name from a payment app's merchant text (src/lib/person-payees.ts), and so
// a refused key raises the team's alarm whichever path met it (claude_key_refused).
//
// A refused key (the store says 401 to every call) is remembered for a few minutes in this
// function instance: the next calls get the same refusal at once, without a round trip to Claude
// and without waiting for it (every chat turn used to ask, be refused, and only then answer from
// Jane's own words), and then one call goes through to see whether the key works again. Only the
// refusal's code is kept, never the key.
let refused: { until: number; status: number } | null = null;
// Whether the one call that tries again is out.
let probing = false;

export const claudeFetch: typeof fetch = async (input, init) => {
  await freshSwitches();
  if (killed("claude")) throw new Error("Claude is paused (KILL_CLAUDE)");
  const probe = refused !== null && Date.now() >= refused.until;
  if (refused && (!probe || probing)) return refusal(refused.status);
  // The pause is over: this call is the one that tries again, and the rest are refused until its
  // answer is in, however long that takes.
  if (probe) probing = true;
  let response: Response;
  try {
    response = await send(input, init);
  } catch (error) {
    if (probe) {
      // No answer: the pause starts over, and the next call after it tries again.
      probing = false;
      refused = { ...refused!, until: Date.now() + CLAUDE_REFUSED_PROBE_MS };
    }
    throw error;
  }
  if (probe) probing = false;
  if (response.status === 401) {
    // Only the first refusal of a pause is logged and raised; the probe after it starts another.
    log.warn("Claude refused the key; calls to it are paused for a few minutes", {
      status: response.status,
    });
    refused = { until: Date.now() + CLAUDE_REFUSED_PAUSE_MS, status: response.status };
    await recordOpsEvent("claude_key_refused", { code: `HTTP_${response.status}` });
  } else {
    // Only the probe's answer ends a pause: a call that was already out when the key was refused
    // may come back with anything, and must not undo it. A 403 is a missing permission for one
    // model or resource (the key still works for others), so it raises the alarm but pauses nothing.
    if (probe) refused = null;
    if (response.status === 403) {
      await recordOpsEvent("claude_key_refused", { code: `HTTP_${response.status}` });
    }
  }
  return response;
};

// The answer the store gives a refused key, as the client library reads it (it throws the same
// error as for the real one, and does not retry a refusal).
function refusal(status: number): Response {
  return new Response(
    JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: "Claude calls are paused after a refusal" },
    }),
    { status, headers: { "content-type": "application/json", "x-jane-paused": "1" } },
  );
}

// For tests: forget a remembered refusal.
export function resetClaudeRefusalForTests() {
  refused = null;
  probing = false;
}

function send(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) {
  if (typeof init?.body !== "string") return fetch(input, init);
  const body = redactRequestBody(init.body);
  if (body === init.body) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.delete("content-length");
  return fetch(input, { ...init, body, headers });
}

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
  resetClaudeRefusalForTests();
}

// The text of a finished JSON answer, or null when Claude stopped early or refused.
export function finishedText(response: Anthropic.Message): string | null {
  if (response.stop_reason !== "end_turn") return null;
  const block = response.content.find((b) => b.type === "text");
  return block?.type === "text" ? block.text : null;
}
