import { beforeEach, describe, expect, it, vi } from "vitest";

const { userFindUnique, userUpdate, userUpdateMany } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  userUpdateMany: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: userFindUnique, update: userUpdate, updateMany: userUpdateMany } },
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { track } from "@/lib/analytics";
import { unsubscribeToken } from "@/lib/digest/unsubscribe";
import { POST } from "./route";

// Spec step 85: "Stop these emails" in Jane's email of chat messages.

const post = (query: string) =>
  POST(new Request(`https://app.example.com/api/unsubscribe?${query}`, { method: "POST" }));

describe("POST /api/unsubscribe?what=chat", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    userFindUnique.mockReset().mockResolvedValue({
      chatNotifyPrefs: { channel: "both", kinds: { brief: true } },
    });
    userUpdate.mockReset();
    userUpdateMany.mockReset();
  });

  it("stops Jane's emails and keeps phone notifications and the weekly email", async () => {
    const response = await post(`token=${unsubscribeToken("u1")}&what=chat&from=page`);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/unsubscribe?done=1&what=chat",
    );
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        chatNotifyPrefs: {
          channel: "push",
          kinds: { decision: true, heads_up: true, done: true, brief: true },
        },
      },
    });
    expect(userUpdateMany).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("u1", "chat_emails_unsubscribed", {});
  });

  it("works one-click from the mail app, and refuses a forged token", async () => {
    userFindUnique.mockResolvedValue({ chatNotifyPrefs: { channel: "email" } });
    expect((await post(`token=${unsubscribeToken("u1")}&what=chat`)).status).toBe(200);
    expect(userUpdate.mock.calls[0][0].data.chatNotifyPrefs.channel).toBe("off");
    expect((await post("token=abc.def&what=chat")).status).toBe(400);
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });
});
