import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/jane-agent/clear-chat", () => ({ clearChat: vi.fn() }));

import { revalidatePath } from "next/cache";
import { clearChat } from "@/lib/jane-agent/clear-chat";
import { clearChatAction } from "./clear";

// The server action behind "Clear chat": the signed-in person's own chat only, and only with the
// confirm the second tap sends; a failure says so and deletes nothing.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const START = { error: null, clearedAt: 0 };

describe("clearChatAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the signed-in person's chat after the confirm, and reloads the chat", async () => {
    vi.mocked(clearChat).mockResolvedValue({ messages: 4, conversations: 1, unpinned: 0 });
    const state = await clearChatAction(START, form({ confirm: "yes", userId: "someone-else" }));
    expect(clearChat).toHaveBeenCalledExactlyOnceWith("u1");
    expect(revalidatePath).toHaveBeenCalledWith("/chat");
    expect(state.error).toBeNull();
    expect(state.clearedAt).toBeGreaterThan(0);
  });

  it("does nothing without the confirm", async () => {
    const state = await clearChatAction(START, form({}));
    expect(clearChat).not.toHaveBeenCalled();
    expect(state).toEqual(START);
  });

  it("says plainly when it could not delete, and the chat stays", async () => {
    vi.mocked(clearChat).mockRejectedValue(new Error("db down"));
    const state = await clearChatAction(START, form({ confirm: "yes" }));
    expect(state.error).toMatch(/Nothing was deleted/);
    expect(state.clearedAt).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
