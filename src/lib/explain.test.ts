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

import { SECRET_STRINGS, findingOfType, sampleFindings } from "./__fixtures__/findings";
import { resetAnthropicForTests } from "./anthropic";
import { explainFinding, parseExplanation } from "./explain";

const GOOD = {
  title: "Your Netflix plan went up",
  explanation:
    "Netflix now charges $17.99 a month instead of $15.49. Asking for the old rate could save about $30 a year.",
  give_up: "Nothing, unless you switch to a smaller plan.",
  alternatives: ["Switch to the ad-supported plan", "Pause for a month"],
};

function reply(body: unknown, stop_reason = "end_turn") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { stop_reason, content: [{ type: "text", text }] };
}

const priceIncrease = () => findingOfType("price_increase");

describe("explainFinding", () => {
  beforeEach(() => {
    resetAnthropicForTests();
    create.mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-test-model");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns Claude's text when it passes every check", async () => {
    create.mockResolvedValue(reply(GOOD));

    const result = await explainFinding(priceIncrease());

    expect(result).toMatchObject({
      kind: "llm",
      model: "claude-test-model",
      content: {
        title: GOOD.title,
        explanation: GOOD.explanation,
        giveUp: GOOD.give_up,
        alternatives: GOOD.alternatives,
      },
    });
    const request = create.mock.calls[0][0];
    expect(request.model).toBe("claude-test-model");
    expect(request.output_config.format.type).toBe("json_schema");
  });

  it.each(sampleFindings().map((f) => [f.type, f] as const))(
    "sends no personal identifiers in the request for %s",
    async (_type, finding) => {
      create.mockResolvedValue(reply(GOOD));

      await explainFinding(finding);

      const payload = JSON.stringify(create.mock.calls[0][0].messages);
      for (const secret of SECRET_STRINGS) expect(payload).not.toContain(secret);
      expect(payload).not.toMatch(/@|description|accountId|accountName/);
    },
  );

  it("uses the template without an API key and never calls Claude", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    for (const finding of sampleFindings()) {
      const result = await explainFinding(finding);
      expect(result).toMatchObject({ kind: "template", reason: "no_api_key" });
      expect(result.content.explanation.length).toBeGreaterThan(0);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("falls back when a dollar figure doesn't match the evidence", async () => {
    create.mockResolvedValue(
      reply({ ...GOOD, explanation: "Netflix now costs $19.99. You could save about $40 a year." }),
    );

    expect(await explainFinding(priceIncrease())).toMatchObject({
      kind: "template",
      reason: "guardrails",
      issues: ["unsupported_dollar_figure"],
    });
  });

  it("falls back on investment advice, tax advice or a guarantee", async () => {
    for (const explanation of [
      "Invest the $30 you save in an index fund.",
      "This fee may be tax deductible.",
      "You will save $30 a year.",
    ]) {
      create.mockResolvedValueOnce(reply({ ...GOOD, explanation }));
      expect(await explainFinding(priceIncrease())).toMatchObject({ reason: "guardrails" });
    }
  });

  it("falls back on a refusal, invalid JSON or the wrong shape", async () => {
    create.mockResolvedValueOnce(reply(GOOD, "refusal"));
    expect(await explainFinding(priceIncrease())).toMatchObject({ reason: "refused" });

    create.mockResolvedValueOnce(reply("{not json"));
    expect(await explainFinding(priceIncrease())).toMatchObject({ reason: "invalid_output" });

    create.mockResolvedValueOnce(reply({ ...GOOD, give_up: undefined }));
    expect(await explainFinding(priceIncrease())).toMatchObject({ reason: "invalid_output" });
  });

  it("reports the API being down separately, so it is retried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValue(new APIError("overloaded"));

    expect(await explainFinding(priceIncrease())).toMatchObject({ kind: "unavailable" });
  });

  it("hashes the input so the cache can tell when evidence changes", async () => {
    create.mockResolvedValue(reply(GOOD));
    const finding = priceIncrease();

    const first = await explainFinding(finding);
    const again = await explainFinding(finding);
    const changed = await explainFinding({ ...finding, annualSavingsCents: 3100 });

    expect(again.hash).toBe(first.hash);
    expect(changed.hash).not.toBe(first.hash);
  });
});

describe("parseExplanation", () => {
  const parse = (overrides: Record<string, unknown>) =>
    parseExplanation(JSON.stringify({ ...GOOD, ...overrides }));

  it("keeps at most three alternatives", () => {
    expect(parse({ alternatives: ["a", "b", "c", "d"] })?.alternatives).toEqual(["a", "b", "c"]);
  });

  it("rejects an explanation longer than two sentences", () => {
    expect(parse({ explanation: "One. Two. Three." })).toBeNull();
  });

  it("rejects a give-up line longer than one sentence", () => {
    expect(parse({ give_up: "One. Two." })).toBeNull();
  });

  it("rejects empty or overlong fields", () => {
    expect(parse({ title: "" })).toBeNull();
    expect(parse({ title: "x".repeat(81) })).toBeNull();
    expect(parse({ alternatives: ["x".repeat(61)] })).toBeNull();
  });
});
