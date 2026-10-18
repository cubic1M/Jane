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

import { resetAnthropicForTests } from "./anthropic";
import { checkSubscriptions } from "./subscription-check";

function reply(results: { merchant: string; isSubscription: unknown }[], stop_reason = "end_turn") {
  return { stop_reason, content: [{ type: "text", text: JSON.stringify({ results }) }] };
}

describe("checkSubscriptions", () => {
  beforeEach(() => {
    resetAnthropicForTests();
    create.mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-test-model");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends only merchant names and returns Claude's answers", async () => {
    create.mockResolvedValue(
      reply([
        { merchant: "Canva", isSubscription: true },
        { merchant: "Mystery Club", isSubscription: false },
      ]),
    );

    const answers = await checkSubscriptions(["Canva", "Mystery Club"]);

    expect(answers).toEqual(
      new Map([
        ["Canva", true],
        ["Mystery Club", false],
      ]),
    );
    const request = create.mock.calls[0][0];
    expect(request.model).toBe("claude-test-model");
    expect(request.messages).toEqual([
      { role: "user", content: JSON.stringify({ merchants: ["Canva", "Mystery Club"] }) },
    ]);
    expect(request.output_config.format.type).toBe("json_schema");
  });

  it("does nothing without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect(await checkSubscriptions(["Canva"])).toEqual(new Map());
    expect(create).not.toHaveBeenCalled();
  });

  it("ignores merchants it wasn't asked about and answers that aren't yes or no", async () => {
    create.mockResolvedValue(
      reply([
        { merchant: "Other", isSubscription: true },
        { merchant: "Canva", isSubscription: "maybe" },
      ]),
    );

    expect(await checkSubscriptions(["Canva"])).toEqual(new Map());
  });

  it("returns nothing on a refusal, an API failure or invalid JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockResolvedValueOnce(reply([{ merchant: "Canva", isSubscription: true }], "refusal"));
    expect(await checkSubscriptions(["Canva"])).toEqual(new Map());

    create.mockRejectedValueOnce(new APIError("overloaded"));
    expect(await checkSubscriptions(["Canva"])).toEqual(new Map());

    create.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "{" }],
    });
    expect(await checkSubscriptions(["Canva"])).toEqual(new Map());
  });

  it("splits long lists into batches", async () => {
    create.mockResolvedValue(reply([]));

    await checkSubscriptions(Array.from({ length: 120 }, (_, i) => `m${i}`));

    expect(create).toHaveBeenCalledTimes(3);
  });
});
