import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFields } from "./read-fields";

// Claude reading fields off an uploaded document, shared by tax returns, notices and policies.

const PDF = { bytes: Buffer.from("%PDF-1.7\n"), contentType: "application/pdf" as const };
const PNG = { bytes: Buffer.from("png"), contentType: "image/png" as const };
const KEYS = ["amount", "taxYear"] as const;

const fake = (response: unknown) => {
  const create = vi.fn(async () => response);
  return { create, claude: (() => ({ messages: { create } })) as never };
};
const answer = (text: string, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "text", text }],
});

describe("readFields", () => {
  beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", "test-key"));
  afterEach(() => vi.unstubAllEnvs());

  it("asks for every key and keeps the values found, trimmed", async () => {
    const { create, claude } = fake(answer(JSON.stringify({ amount: " 1234.56 ", taxYear: "" })));
    const result = await readFields(PDF, {
      keys: KEYS,
      prompt: "Read it.",
      maxTokens: 700,
      claude,
    });
    expect(result).toEqual({ kind: "claude", fields: { amount: "1234.56" } });
    const call = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0] as {
      max_tokens: number;
      messages: { content: { type: string }[] }[];
      output_config: { format: { schema: { required: string[] } } };
    };
    expect(call.max_tokens).toBe(700);
    expect(call.messages[0].content.map((b) => b.type)).toEqual(["document", "text"]);
    expect(call.output_config.format.schema.required).toEqual(["amount", "taxYear"]);
  });

  it("sends a photo as an image", async () => {
    const { create, claude } = fake(answer("{}"));
    await readFields(PNG, { keys: KEYS, prompt: "Read it.", maxTokens: 700, claude });
    const call = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0] as {
      messages: { content: { type: string }[] }[];
    };
    expect(call.messages[0].content[0].type).toBe("image");
  });

  it("reads nothing without a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { create, claude } = fake(answer("{}"));
    expect(await readFields(PDF, { keys: KEYS, prompt: "", maxTokens: 1, claude })).toEqual({
      kind: "unavailable",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("says why when reading fails", async () => {
    const read = (claude: never) =>
      readFields(PDF, { keys: KEYS, prompt: "", maxTokens: 1, claude });
    expect(await read(fake(answer("{}", "max_tokens")).claude)).toEqual({
      kind: "failed",
      reason: "unfinished",
    });
    expect(await read(fake(answer("not json")).claude)).toEqual({
      kind: "failed",
      reason: "not_json",
    });
    expect(await read(fake(answer("[1]")).claude)).toEqual({ kind: "failed", reason: "not_json" });
    const overloaded = vi.fn(async () => {
      throw new Anthropic.APIError(529, undefined, "overloaded", new Headers());
    });
    expect(await read((() => ({ messages: { create: overloaded } })) as never)).toEqual({
      kind: "failed",
      reason: "api_529",
    });
    const broken = vi.fn(async () => {
      throw new Error("socket");
    });
    expect(await read((() => ({ messages: { create: broken } })) as never)).toEqual({
      kind: "failed",
      reason: "error",
    });
  });
});
