import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops-alerts", () => ({ recordOpsEvent: vi.fn(async () => ({})) }));

import Anthropic from "@anthropic-ai/sdk";
import { OPS_EVENT_KINDS } from "@/config/ops-alerts";
import { anthropic, claudeFetch, resetAnthropicForTests } from "@/lib/anthropic";
import { recordOpsEvent } from "@/lib/ops-alerts";

// Claude refusing Jane's key raises the team's alarm, whichever path met it (src/lib/anthropic.ts
// claudeFetch). From 11-17 production's explanations and the strategist got a 401 every day on the
// Plaid webhook and the nightly sync, and only logged it: the explanation fell back to its template,
// the request answered 200, and nobody was told.

const reply = (status: number) =>
  vi.fn(
    async () =>
      new Response(
        status === 200
          ? JSON.stringify({
              id: "msg",
              type: "message",
              role: "assistant",
              model: "claude-opus-5-5",
              content: [{ type: "text", text: "{}" }],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            })
          : JSON.stringify({
              type: "error",
              error: { type: "authentication_error", message: "invalid x-api-key" },
            }),
        { status, headers: { "content-type": "application/json" } },
      ),
  );

describe("a key Claude refuses", () => {
  beforeEach(() => {
    vi.mocked(recordOpsEvent).mockClear();
    resetAnthropicForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetAnthropicForTests();
  });

  it.each([401, 403])("raises the alarm on a %i", async (status) => {
    vi.stubGlobal("fetch", reply(status));
    const response = await claudeFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(status);
    expect(recordOpsEvent).toHaveBeenCalledWith("claude_key_refused", { code: `HTTP_${status}` });
  });

  it.each([200, 429, 500, 529])("stays quiet on a %i: not the key", async (status) => {
    vi.stubGlobal("fetch", reply(status));
    await claudeFetch("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" });
    expect(recordOpsEvent).not.toHaveBeenCalled();
  });

  it("raises it through the client every path uses, and the caller still sees the 401", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-key-claude-refuses");
    vi.stubGlobal("fetch", reply(401));
    const error = await anthropic()
      .messages.create({
        model: "claude-opus-5-5",
        max_tokens: 10,
        messages: [{ role: "user", content: "Explain this finding." }],
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Anthropic.APIError);
    expect((error as InstanceType<typeof Anthropic.APIError>).status).toBe(401);
    expect(recordOpsEvent).toHaveBeenCalledWith("claude_key_refused", { code: "HTTP_401" });
  });

  it("is an urgent kind: the team is emailed at once", () => {
    expect(OPS_EVENT_KINDS.claude_key_refused).toEqual({
      label: "Claude refused Jane's API key",
      urgent: true,
    });
  });
});
