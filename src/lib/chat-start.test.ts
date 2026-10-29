import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
  }),
}));
const findUnique = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { session: { findUnique } } }));

import { CHAT_SIGN_IN_GRACE_SECONDS } from "@/config/agent-chat";
import { chatSince, currentChatStart, sessionStartedAt } from "./chat-start";

// Each sign-in starts the chat fresh: the chat shows what came after this session began.

const SIGNED_IN = new Date("2026-10-29T15:00:00Z");

describe("the start of this sign-in's chat", () => {
  beforeEach(() => {
    cookieJar.clear();
    findUnique.mockReset();
  });

  it("is a moment before the session began", () => {
    expect(chatSince(SIGNED_IN).getTime()).toBe(
      SIGNED_IN.getTime() - CHAT_SIGN_IN_GRACE_SECONDS * 1000,
    );
  });

  it("reads the session by its token, never another's", async () => {
    findUnique.mockResolvedValue({ createdAt: SIGNED_IN });
    expect(await sessionStartedAt("tok")).toEqual(SIGNED_IN);
    expect(findUnique).toHaveBeenCalledWith({
      where: { sessionToken: "tok" },
      select: { createdAt: true },
    });
    expect(await sessionStartedAt(undefined)).toBeNull();
    findUnique.mockResolvedValue(null);
    expect(await sessionStartedAt("gone")).toBeNull();
  });

  it("comes from this browser's session cookie, or is the whole chat without one", async () => {
    expect(await currentChatStart()).toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
    cookieJar.set("authjs.session-token", "tok");
    findUnique.mockResolvedValue({ createdAt: SIGNED_IN });
    expect(await currentChatStart()).toEqual(chatSince(SIGNED_IN));
  });
});
