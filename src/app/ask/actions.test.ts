import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/ask/conversations", () => ({ deleteConversation: vi.fn() }));

import { deleteConversation } from "@/lib/ask/conversations";
import { deleteAskConversation } from "./actions";

describe("deleteAskConversation", () => {
  it("deletes the signed-in person's conversation and goes back to Ask", async () => {
    const form = new FormData();
    form.set("conversationId", "c1");
    await expect(deleteAskConversation(form)).rejects.toThrow("redirect:/ask");
    expect(deleteConversation).toHaveBeenCalledWith("u1", "c1");
  });
});
