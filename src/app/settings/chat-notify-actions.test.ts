import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { update: vi.fn() } } }));

import { track } from "@/lib/analytics";
import { db } from "@/lib/db";
import { saveChatNotifyPreferences } from "./chat-notify-actions";

// Spec step 85: "Messages from Jane" in Settings.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("saveChatNotifyPreferences", () => {
  beforeEach(() => vi.mocked(db.user.update).mockReset());

  it("saves the channel and the kinds ticked, for the signed-in person", async () => {
    expect(
      await saveChatNotifyPreferences(
        null,
        form({ channel: "email", decision: "on", brief: "on" }),
      ),
    ).toEqual({ ok: true, message: "Saved." });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        chatNotifyPrefs: {
          channel: "email",
          kinds: { decision: true, heads_up: false, done: false, brief: true },
        },
      },
    });
    expect(track).toHaveBeenCalledWith("u1", "chat_notify_prefs_saved", {
      channel: "email",
      decision: true,
      heads_up: false,
      done: false,
      brief: true,
    });
  });

  it("turns everything off", async () => {
    await saveChatNotifyPreferences(null, form({ channel: "off" }));
    expect(vi.mocked(db.user.update).mock.calls[0][0].data).toMatchObject({
      chatNotifyPrefs: { channel: "off" },
    });
  });

  it("refuses a channel that isn't one of the choices", async () => {
    expect(await saveChatNotifyPreferences(null, form({ channel: "sms" }))).toMatchObject({
      ok: false,
    });
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
