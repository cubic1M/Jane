import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tools", () => ({ ASK_TOOLS: [], runAskTool: vi.fn() }));

import { ASK_BLOCKED_REPLY, ASK_UNAVAILABLE_REPLY } from "@/config/ask";
import { askJane } from "./answer";
import { runAskTool } from "./tools";

const create = vi.fn();
const claude = () => ({ messages: { create } }) as never;

const toolUse = (name: string, id = "t1") => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name, input: {} }],
});
const final = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

describe("askJane", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    create.mockReset();
    vi.mocked(runAskTool)
      .mockReset()
      .mockResolvedValue({ content: '{"spending":"$412.30"}', cents: [41_230] });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers with figures that came from a tool", async () => {
    create
      .mockResolvedValueOnce(toolUse("spending_by_category"))
      .mockResolvedValueOnce(final("You spent $412.30 on food last month."));
    const statuses: string[] = [];

    const result = await askJane("u1", [], "How much on food?", {
      claude,
      onStatus: (s) => statuses.push(s),
    });

    expect(result).toEqual({ kind: "answer", text: "You spent $412.30 on food last month." });
    expect(runAskTool).toHaveBeenCalledWith("u1", "spending_by_category", {}, expect.any(Object));
    expect(statuses).toEqual(["Adding up your spending…"]);
    // The tool result went back to Claude under the right id.
    expect(create.mock.calls[1][0].messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: '{"spending":"$412.30"}' }],
    });
  });

  it("catches a figure that isn't in any tool result", async () => {
    create
      .mockResolvedValueOnce(toolUse("spending_by_category"))
      .mockResolvedValueOnce(final("You spent $412.30, so about $5,000.00 a year."));

    expect(await askJane("u1", [], "How much on food?", { claude })).toEqual({
      kind: "blocked",
      text: ASK_BLOCKED_REPLY,
      issues: ["unsupported_dollar_figure"],
    });
  });

  it("allows figures from the question and from earlier answers", async () => {
    create.mockResolvedValueOnce(final("Yes, $50.00 is more than the $12.99 Netflix charge."));
    const history = [
      { role: "user" as const, content: "Netflix?" },
      { role: "assistant" as const, content: "Netflix charged $12.99." },
    ];
    expect(await askJane("u1", history, "Is $50 a lot?", { claude })).toMatchObject({
      kind: "answer",
    });
  });

  it("blocks advice", async () => {
    create.mockResolvedValueOnce(final("Put your extra cash in an index fund."));
    expect(await askJane("u1", [], "What should I do?", { claude })).toMatchObject({
      kind: "blocked",
      issues: ["investment_advice"],
    });
  });

  it("is unavailable without a key, on a refusal, or after too many lookups", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await askJane("u1", [], "Hi", { claude })).toEqual({
      kind: "unavailable",
      text: ASK_UNAVAILABLE_REPLY,
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");

    create.mockResolvedValueOnce({ stop_reason: "refusal", content: [] });
    expect(await askJane("u1", [], "Hi", { claude })).toMatchObject({ kind: "unavailable" });

    create.mockReset().mockResolvedValue(toolUse("list_findings"));
    expect(await askJane("u1", [], "Hi", { claude })).toMatchObject({ kind: "unavailable" });
  });
});
