import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { create, APIError } = vi.hoisted(() => ({
  create: vi.fn(),
  APIError: class APIError extends Error {
    status = 529;
  },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    static APIError = APIError;
    messages = { create };
  },
}));

import { classifyMerchants, resetLlmClientForTests } from "./llm";

function reply(results: { merchant: string; category: string }[], stop_reason = "end_turn") {
  return { stop_reason, content: [{ type: "text", text: JSON.stringify({ results }) }] };
}

describe("classifyMerchants", () => {
  beforeEach(() => {
    resetLlmClientForTests();
    create.mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-test-model");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends only merchant names and returns their categories", async () => {
    create.mockResolvedValue(
      reply([{ merchant: "corner market", category: "FOOD_AND_DRINK_GROCERIES" }]),
    );

    const result = await classifyMerchants(["corner market"]);

    expect(result).toEqual(new Map([["corner market", "FOOD_AND_DRINK_GROCERIES"]]));
    const request = create.mock.calls[0][0];
    expect(request.model).toBe("claude-test-model");
    expect(request.messages).toEqual([
      { role: "user", content: JSON.stringify({ merchants: ["corner market"] }) },
    ]);
    expect(request.output_config.format.type).toBe("json_schema");
  });

  it("does nothing without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect(await classifyMerchants(["corner market"])).toEqual(new Map());
    expect(create).not.toHaveBeenCalled();
  });

  it("ignores UNKNOWN, invented categories and merchants it wasn't asked about", async () => {
    create.mockResolvedValue(
      reply([
        { merchant: "a", category: "UNKNOWN" },
        { merchant: "b", category: "SUBSCRIPTIONS" },
        { merchant: "zzz", category: "FOOD_AND_DRINK_COFFEE" },
      ]),
    );

    expect(await classifyMerchants(["a", "b"])).toEqual(new Map());
  });

  it("returns nothing on a refusal or truncated reply", async () => {
    create.mockResolvedValue(reply([{ merchant: "a", category: "TRAVEL_FLIGHTS" }], "refusal"));

    expect(await classifyMerchants(["a"])).toEqual(new Map());
  });

  it("keeps going when the API fails or returns invalid JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValueOnce(new APIError("overloaded"));
    expect(await classifyMerchants(["a"])).toEqual(new Map());

    create.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "{" }],
    });
    expect(await classifyMerchants(["a"])).toEqual(new Map());
  });

  it("splits long lists into batches", async () => {
    create.mockResolvedValue(reply([]));
    const merchants = Array.from({ length: 120 }, (_, i) => `m${i}`);

    await classifyMerchants(merchants);

    expect(create).toHaveBeenCalledTimes(3);
  });

  it("sends the batches at once, not one after another, and keeps the others if one fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    create
      .mockImplementationOnce(async () => {
        await gate;
        return reply([{ merchant: "m0", category: "FOOD_AND_DRINK_GROCERIES" }]);
      })
      .mockImplementationOnce(async () => {
        throw new APIError("overloaded");
      });
    const merchants = Array.from({ length: 60 }, (_, i) => `m${i}`);

    const answer = classifyMerchants(merchants);
    // Both started while the first is still waiting.
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    release();
    expect(await answer).toEqual(new Map([["m0", "FOOD_AND_DRINK_GROCERIES"]]));
  });
});
