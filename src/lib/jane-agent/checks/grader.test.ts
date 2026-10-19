import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import type { CheckQuestion } from "./bank";
import type { Facts } from "./facts";
import { gradeWithClaude } from "./grader";
import { conversations, costOf } from "./run";

// Spec step 87: Claude's grade by the rubric (a fake client here), what Claude costs
// toward the cap, and the order questions are asked in.

const facts: Facts = {
  asOf: "2026-10-18",
  safeCents: 100,
  payday: null,
  allowedCents: [],
  recurring: [],
  months: {},
  findings: [],
};
const input = { question: "q", earlier: [], answer: "a", buttons: [], facts };
const reply = (text: string, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "text", text }],
  usage: { input_tokens: 2_000, output_tokens: 100 },
});
const client = (create: () => Promise<unknown>) => () => ({ messages: { create } }) as never;

describe("gradeWithClaude", () => {
  it("turns the rubric's two scores into 0–100, with the reason", async () => {
    const create = vi.fn(async () => reply('{"usefulness":5,"tone":3,"reason":"Too stiff."}'));
    const { grade, usage } = await gradeWithClaude(input, client(create));
    expect(grade).toEqual({ usefulness: 5, tone: 3, reason: "Too stiff.", score: 75 });
    expect(usage).toMatchObject({ inputTokens: 2_000, outputTokens: 100 });
    const request = (create.mock.calls[0] as unknown[])[0] as {
      output_config: { format: { type: string } };
    };
    expect(request.output_config.format.type).toBe("json_schema");
  });

  it("gives no grade for bad output, a refusal or an API error, but still counts the cost", async () => {
    expect(
      (
        await gradeWithClaude(
          input,
          client(async () => reply('{"usefulness":9,"tone":3,"reason":""}')),
        )
      ).grade,
    ).toBeNull();
    const refused = await gradeWithClaude(
      input,
      client(async () => reply("", "refusal")),
    );
    expect(refused.grade).toBeNull();
    expect(refused.usage).not.toBeNull();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await gradeWithClaude(
      input,
      client(async () => {
        throw new Anthropic.APIError(500, undefined, "down", new Headers());
      }),
    );
    expect(failed).toEqual({ grade: null, usage: null });
  });
});

describe("costOf", () => {
  it("prices tokens per model, and an unknown model at the most expensive", () => {
    expect(costOf({ model: "claude-sonnet-5-5", inputTokens: 1_000_000, outputTokens: 0 })).toBe(
      200,
    );
    expect(costOf({ model: "claude-opus-5-5", inputTokens: 0, outputTokens: 1_000_000 })).toBe(
      2_000,
    );
    expect(costOf({ model: "something-new", inputTokens: 1_000_000, outputTokens: 0 })).toBe(1_000);
  });
});

describe("conversations", () => {
  it("asks each follow-up right after its first question", () => {
    const q = (id: string, after?: string): CheckQuestion => ({
      id,
      text: id,
      needs: "rules",
      after,
      expect: {},
    });
    expect(
      conversations([q("a"), q("b"), q("a2", "a"), q("c"), q("b2", "b")]).map((c) =>
        c.map((x) => x.id),
      ),
    ).toEqual([["a", "a2"], ["b", "b2"], ["c"]]);
  });
});
