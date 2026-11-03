import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("../typing", () => ({ sendToJane: vi.fn() }));

import type { PrismaClient } from "@/generated/prisma/client";
import { sendToJane } from "../typing";
import { newPlayed, playbackClaude, runRealPath } from "./real-path";
import type { CheckQuestion } from "./bank";

// What the nightly real-path check calls a failure (the whole path, on a real database:
// real-path.integration.test.ts). A check that can't fail is no signal.

const client = {
  rateLimit: { deleteMany: vi.fn(async () => ({ count: 0 })) },
} as unknown as PrismaClient;
const question = (tool?: string): CheckQuestion =>
  ({ id: "q", text: "how much", needs: "claude", expect: {}, tool }) as CheckQuestion;

const run = (outcome: () => Promise<unknown>, tool?: string) => {
  vi.mocked(sendToJane).mockImplementation((async (_u: string, _t: string, options: never) => {
    const { onEvent } = options as { onEvent: (e: { type: string }) => void };
    return outcome.call({ onEvent });
  }) as never);
  return runRealPath("u1", { client, now: new Date(), questions: [question(tool)] });
};
const replied =
  (source: string, body = "Words.") =>
  async () => ({
    reply: { body, actions: [], refs: {} },
    source,
  });

describe("runRealPath fails", () => {
  it.each([
    ["claude_blocked", "blocked"],
    ["claude_unavailable", "fell_back"],
    ["fallback", "fell_back"],
    ["capped", "capped"],
  ])("an answer from %s", async (source, name) => {
    const result = await run(replied(source));
    expect(result.results[0].failed).toContain(name);
    expect(result.score).toBe(0);
  });

  it("an answer that never started", async () => {
    expect((await run(replied("claude"))).failures).toEqual({ never_started: 1 });
  });

  it("a chat that throws", async () => {
    const result = await run(async () => {
      throw new Error("boom");
    });
    expect(result.failures).toEqual({ threw: 1 });
  });

  it("empty words", async () => {
    expect((await run(replied("rules", " "))).failures).toEqual({ no_words: 1 });
  });

  it("restores the environment, even when it had no key", async () => {
    const before = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await run(replied("rules"));
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    if (before !== undefined) process.env.ANTHROPIC_API_KEY = before;
  });
});

describe("the played-back model", () => {
  const stream = (q: CheckQuestion, params: object) => {
    const played = newPlayed();
    const client = playbackClaude(q, played)();
    return {
      played,
      message: client.messages.stream(params as never).finalMessage(),
    };
  };
  const goals = { name: "goals", input_schema: { type: "object" } };

  it("calls the tool the question should reach, then says its first figure", async () => {
    const first = await stream(question("goals"), { messages: [], tools: [goals] }).message;
    expect(first.stop_reason).toBe("tool_use");
    const second = await stream(question("goals"), {
      tools: [goals],
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "played", content: '{"saved":"$42.00"}' }],
        },
      ],
    }).message;
    expect(second.content[0]).toMatchObject({
      type: "text",
      text: "I can see $42.00 in your accounts for that.",
    });
  });

  it.each(["propose_action", "finding_details", "show_block"])(
    "doesn't make up what %s needs",
    async (name) => {
      const message = await stream(question(name), {
        messages: [],
        tools: [{ name, input_schema: { type: "object" } }],
      }).message;
      expect(message.stop_reason).toBe("end_turn");
    },
  );
});

describe("the rounds where Claude doesn't answer at first", () => {
  const speak = (...texts: string[]) => {
    vi.mocked(sendToJane).mockImplementation((async (_u: string, _t: string, options: never) => {
      const { onEvent } = options as { onEvent: (e: { type: string; text?: string }) => void };
      for (const text of texts) {
        if (text === "RESET") onEvent({ type: "reset" });
        else onEvent({ type: "text", text });
      }
      return { reply: { body: texts.at(-1), actions: [], refs: {} }, source: "claude" };
    }) as never);
  };
  const round = (name: "refused_first" | "blocked_first") =>
    runRealPath("u1", { client, now: new Date(), questions: [question()], rounds: [name] });

  it("fails what is left on screen", async () => {
    speak("This is guaranteed to work.");
    expect((await round("blocked_first")).results[0].failed).toContain("shown");
  });

  it("doesn't fail what was taken back", async () => {
    speak("Let me start on that by looking at", "RESET", "Your card has $42.00 on it.");
    const result = await round("refused_first");
    expect(result.results[0].failed).not.toContain("shown");
  });

  it("fails a chat that never asked again", async () => {
    speak("Your card has $42.00 on it.");
    expect((await round("refused_first")).results[0].failed).toContain("not_asked_again");
  });

  it("names the round in the result", async () => {
    speak("Your card has $42.00 on it.");
    expect((await round("refused_first")).results[0].id).toBe("q#refused_first");
  });
});
