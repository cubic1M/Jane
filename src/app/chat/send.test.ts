import { beforeEach, describe, expect, it, vi } from "vitest";

// Spec step 84: the chat box sends what the signed-in person typed to sendToJane, refreshes
// the chat, and shows a refusal (empty, too long, too many) without logging the text.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// This sign-in's chat starts here (src/lib/chat-start.ts).
const SINCE = vi.hoisted(() => new Date("2026-10-29T15:00:00Z"));
vi.mock("@/lib/chat-start", () => ({ currentChatStart: vi.fn(async () => SINCE) }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/jane-agent/typing", () => {
  class ChatInputError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { ChatInputError, sendToJane: vi.fn() };
});

import { revalidatePath } from "next/cache";
import { ChatInputError, sendToJane } from "@/lib/jane-agent/typing";
import { sendMessage } from "./send";

const form = (message: string) => {
  const data = new FormData();
  data.append("message", message);
  return data;
};
const start = { error: null, sentAt: 0 };

describe("sendMessage", () => {
  beforeEach(() => {
    vi.mocked(sendToJane).mockReset();
    vi.mocked(revalidatePath).mockClear();
  });

  it("sends for the signed-in person and refreshes the chat", async () => {
    vi.mocked(sendToJane).mockResolvedValue({} as never);
    const state = await sendMessage(start, form("cancel Hulu"));
    // Only this sign-in's conversation is the answer's history.
    expect(sendToJane).toHaveBeenCalledWith("u1", "cancel Hulu", { since: SINCE });
    expect(revalidatePath).toHaveBeenCalledWith("/chat");
    expect(state.error).toBeNull();
    expect(state.sentAt).toBeGreaterThan(0);
  });

  it("shows why a message was refused, without refreshing", async () => {
    vi.mocked(sendToJane).mockRejectedValue(
      new ChatInputError("rate_limited", "That's a lot of messages."),
    );
    expect(await sendMessage(start, form("hi"))).toEqual({
      error: "That's a lot of messages.",
      sentAt: 0,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("never logs the text when something else fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendToJane).mockRejectedValue(new Error("db down: my secret words"));
    expect(await sendMessage(start, form("my secret words"))).toEqual({
      error: "Something went wrong. Try again.",
      sentAt: 0,
    });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret");
    errors.mockRestore();
  });
});
