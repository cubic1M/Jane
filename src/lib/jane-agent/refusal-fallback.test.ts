import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/home", () => ({ homeSummary: vi.fn() }));
vi.mock("./snapshot", () => ({ loadSnapshot: vi.fn() }));
vi.mock("./spend", async (original) => ({
  ...(await original<typeof import("./spend")>()),
  overDailyCap: vi.fn(async () => false),
  addSpend: vi.fn(),
}));

import Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma/client";
import { askClaudeInChat, resetClaudeHealth } from "./claude";
import { forgetPrimer } from "./primer-cache";
import {
  REFUSAL_FALLBACK_BETA,
  afterFallback,
  refusalFallbackOn,
  setRefusalFallbackRejected,
  textOf,
  usageOf,
} from "./refusal-fallback";
import { loadSnapshot, type Snapshot } from "./snapshot";
import { addSpend } from "./spend";

// The server-side refusal fallback (founder 11-01, ./refusal-fallback.ts): every chat request asks
// for `fallbacks: "default"` with its beta header unless CHAT_REFUSAL_FALLBACK is "off"; a switch
// mid-answer keeps one answer; every attempt is paid for; and a 400 for it never breaks the chat.

const NOW = new Date("2026-10-18T15:00:00Z");
const client = {} as PrismaClient;
const create = vi.fn();
const calls: { params: Record<string, unknown>; options: unknown }[] = [];
type Listener = (...args: unknown[]) => void;
const claude = () =>
  ({
    messages: {
      stream: (params: Record<string, unknown>, options?: unknown) => {
        calls.push({ params: structuredClone(params), options });
        const listeners: Record<string, Listener[]> = {};
        const emit = (name: string, ...args: unknown[]) =>
          (listeners[name] ?? []).forEach((fn) => fn(...args));
        const stream = {
          on(name: string, fn: Listener) {
            (listeners[name] ??= []).push(fn);
            return stream;
          },
          async finalMessage() {
            const message = await create(params, options);
            for (const block of message.content) {
              emit("streamEvent", { type: "content_block_start", content_block: block });
              if (block.type === "text") emit("text", block.text);
            }
            return message;
          },
        };
        return stream;
      },
    },
  }) as never;

const MEMORY = "Card: $2,410.50 at 29% APR. Chase fraud line.";
const ask = (question = "someone hacked my bank account") =>
  askClaudeInChat("u1", [], question, { client, now: NOW, claude, memory: MEMORY });
const final = (text: string, extra: object = {}) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text }],
  ...extra,
});
const env = { ...process.env };

beforeEach(() => {
  process.env = { ...env };
  delete process.env.CHAT_REFUSAL_FALLBACK;
  delete process.env.ANTHROPIC_CHAT_MODEL;
  setRefusalFallbackRejected(false);
  create.mockReset();
  calls.length = 0;
  forgetPrimer();
  resetClaudeHealth();
  vi.mocked(addSpend).mockClear();
  vi.mocked(loadSnapshot)
    .mockReset()
    .mockResolvedValue({
      timezone: "America/Los_Angeles",
      findings: [],
      plan: { items: 0, annualSavingsCents: 0, safeItems: 0 },
    } as unknown as Snapshot);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...env };
});

describe("the request", () => {
  it('asks for fallbacks "default" with its beta header, by default', async () => {
    create.mockResolvedValueOnce(
      final("Call Chase's fraud line now; your card has $2,410.50 on it."),
    );
    await ask();
    expect(calls[0].params).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default" });
    expect(calls[0].options).toEqual({ headers: { "anthropic-beta": REFUSAL_FALLBACK_BETA } });
    expect(REFUSAL_FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
  });

  it('sends neither with CHAT_REFUSAL_FALLBACK="off"', async () => {
    process.env.CHAT_REFUSAL_FALLBACK = "off";
    create.mockResolvedValueOnce(final("Call Chase's fraud line now."));
    await ask();
    expect(calls[0].params).not.toHaveProperty("fallbacks");
    expect(calls[0].options).toBeUndefined();
  });

  it("only for a model the docs give the default form for", () => {
    expect(refusalFallbackOn("claude-sonnet-5-5")).toBe(true);
    expect(refusalFallbackOn("claude-opus-5-5")).toBe(true);
    expect(refusalFallbackOn("claude-haiku-5-5")).toBe(false);
    expect(refusalFallbackOn("claude-sonnet-4-6")).toBe(false);
  });
});

describe("an answer the fallback model finished", () => {
  it("is one answer, the sentence carried on across the switch", async () => {
    create.mockResolvedValueOnce({
      stop_reason: "end_turn",
      model: "claude-sonnet-5",
      content: [
        { type: "text", text: "Call Chase's fraud line now" },
        {
          type: "fallback",
          from: { model: "claude-sonnet-5-5" },
          to: { model: "claude-sonnet-5" },
          trigger: { type: "refusal" },
        },
        { type: "text", text: " so they lock the account; your card has $2,410.50 on it." },
      ],
    });
    const result = await ask();
    expect(result.reply.body).toBe(
      "Call Chase's fraud line now so they lock the account; your card has $2,410.50 on it.",
    );
  });

  it("never runs a tool call the declined model started", async () => {
    create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "", signature: "x" },
          { type: "tool_use", id: "half", name: "search_transactions", input: {} },
          {
            type: "fallback",
            from: { model: "claude-sonnet-5-5" },
            to: { model: "claude-sonnet-5" },
            trigger: { type: "refusal" },
          },
          { type: "tool_use", id: "t1", name: "calculate", input: { expression: "1+1" } },
        ],
      })
      .mockResolvedValueOnce(final("Your card has $2,410.50 on it."));
    await ask("how much is on my card");
    const echoed = calls[1].params.messages as { role: string; content: unknown }[];
    const sentBack = JSON.stringify(echoed.at(-2));
    expect(sentBack).not.toContain('"half"');
    expect(sentBack).not.toContain('"thinking"');
    const results = echoed.at(-1)!.content as { tool_use_id: string }[];
    expect(results.map((r) => r.tool_use_id)).toEqual(["t1"]);
  });

  it("pays for every attempt, the declined one too", async () => {
    create.mockResolvedValueOnce(
      final("Call Chase's fraud line now.", {
        usage: {
          input_tokens: 900,
          output_tokens: 40,
          iterations: [
            { type: "message", model: "claude-sonnet-5-5", input_tokens: 1_000, output_tokens: 5 },
            {
              type: "fallback_message",
              model: "claude-sonnet-5",
              input_tokens: 900,
              output_tokens: 40,
            },
          ],
        },
      }),
    );
    await ask();
    const spent = vi.mocked(addSpend).mock.calls.map((c) => c[1]);
    expect(spent).toEqual([
      expect.objectContaining({ model: "claude-sonnet-5-5", inputTokens: 1_000, outputTokens: 5 }),
      expect.objectContaining({ model: "claude-sonnet-5", inputTokens: 900, outputTokens: 40 }),
    ]);
  });

  it("a whole chain that refused is asked once more by the chat itself", async () => {
    create
      .mockResolvedValueOnce({ stop_reason: "refusal", content: [] })
      .mockResolvedValueOnce(final("Call Chase's fraud line now."));
    const result = await ask();
    expect(result.reply.body).toBe("Call Chase's fraud line now.");
  });
});

describe("a 400 for the fallback never breaks the chat", () => {
  const badRequest = () =>
    new Anthropic.APIError(400, { type: "error" }, "fallbacks: not allowed", new Headers());

  it("answers without it, and leaves it off on this server", async () => {
    create
      .mockRejectedValueOnce(badRequest())
      .mockResolvedValueOnce(final("Call Chase's fraud line now."));
    const result = await ask();
    expect(result.reply.body).toBe("Call Chase's fraud line now.");
    expect(calls[1].params).not.toHaveProperty("fallbacks");
    expect(refusalFallbackOn("claude-sonnet-5-5")).toBe(false);
  });

  it("turns it back on when the request fails the same way without it", async () => {
    create.mockRejectedValue(badRequest());
    const result = await ask();
    expect(result.kind).toBe("unavailable");
    expect(create).toHaveBeenCalledTimes(2);
    expect(refusalFallbackOn("claude-sonnet-5-5")).toBe(true);
  });
});

describe("helpers", () => {
  it("afterFallback keeps everything when there was no switch", () => {
    const content = [{ type: "thinking" }, { type: "text", text: "a" }];
    expect(afterFallback(content)).toEqual(content);
  });

  it("textOf joins blocks by line, but not across a switch", () => {
    expect(
      textOf([
        { type: "text", text: "One." },
        { type: "text", text: "Two" },
        { type: "fallback" },
        { type: "text", text: " three." },
      ] as never),
    ).toBe("One.\nTwo three.");
  });

  it("usageOf falls back to the top-level usage", () => {
    expect(usageOf({ input_tokens: 5, output_tokens: 2 }, "claude-sonnet-5-5")).toEqual([
      {
        model: "claude-sonnet-5-5",
        inputTokens: 5,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ]);
    expect(usageOf(undefined, "m")).toHaveLength(1);
  });
});
