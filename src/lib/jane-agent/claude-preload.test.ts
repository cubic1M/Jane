import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/home", () => ({ homeSummary: vi.fn() }));
vi.mock("./snapshot", () => ({ loadSnapshot: vi.fn() }));
vi.mock("./spend", async (original) => ({
  ...(await original<typeof import("./spend")>()),
  overDailyCap: vi.fn(async () => false),
  overMonthlyPersonCap: vi.fn(async () => false),
  addSpend: vi.fn(),
}));
// A short wait for the finding's details, so the test doesn't wait four seconds.
vi.mock("@/config/agent-chat", async (original) => ({
  ...(await original<typeof import("@/config/agent-chat")>()),
  CHAT_FINDING_PRELOAD_MS: 50,
}));
// The finding's details never come back.
vi.mock("./claude-tools", async (original) => ({
  ...(await original<typeof import("./claude-tools")>()),
  runChatTool: vi.fn(() => new Promise(() => {})),
}));

import type { PrismaClient } from "@/generated/prisma/client";
import { askClaudeInChat, resetClaudeHealth } from "./claude";
import { forgetPrimer } from "./primer-cache";

// CodeRabbit part 2: the finding looked up before Claude starts gets a bounded time. When it
// never answers, Claude is still asked, and answers.

type Listener = (...args: unknown[]) => void;
const claude = () =>
  ({
    messages: {
      stream: () => {
        const listeners: Record<string, Listener[]> = {};
        const stream = {
          on(name: string, fn: Listener) {
            (listeners[name] ??= []).push(fn);
            return stream;
          },
          async finalMessage() {
            const text = "Nothing is due this week.";
            (listeners.text ?? []).forEach((fn) => fn(text));
            return { stop_reason: "end_turn", content: [{ type: "text", text }] };
          },
        };
        return stream;
      },
    },
  }) as never;

describe("the finding looked up before Claude starts", () => {
  beforeEach(() => {
    forgetPrimer();
    resetClaudeHealth();
  });

  it("is not waited on for ever", async () => {
    const result = await askClaudeInChat("u1", [], "tell me more", {
      client: {} as PrismaClient,
      now: new Date("2026-10-18T15:00:00Z"),
      claude,
      topic: { kind: "about", findingId: "f1" },
    });
    expect(result.kind).toBe("answer");
    expect(result.reply.body).toContain("Nothing is due this week.");
  });
});
