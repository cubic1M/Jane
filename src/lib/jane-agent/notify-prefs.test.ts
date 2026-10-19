import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_NOTIFY_KINDS } from "@/config/chat-notify";
import { chatNotifyPrefs, notifiesKind, withoutChatEmails } from "./notify-prefs";

// Spec step 85: the person's choices for Jane's messages as notifications.

describe("chatNotifyPrefs", () => {
  it("defaults to push, with the morning brief off", () => {
    expect(chatNotifyPrefs({})).toEqual({ channel: "push", kinds: DEFAULT_CHAT_NOTIFY_KINDS });
    expect(chatNotifyPrefs(null).kinds.brief).toBe(false);
    expect(chatNotifyPrefs(undefined).kinds.decision).toBe(true);
  });

  it("keeps saved choices and drops anything unrecognised", () => {
    expect(
      chatNotifyPrefs({ channel: "both", kinds: { brief: true, done: false, reply: true } }),
    ).toEqual({
      channel: "both",
      kinds: { decision: true, heads_up: true, done: false, brief: true },
    });
    expect(chatNotifyPrefs({ channel: "sms", kinds: { decision: "yes" } })).toEqual({
      channel: "push",
      kinds: DEFAULT_CHAT_NOTIFY_KINDS,
    });
  });
});

describe("notifiesKind", () => {
  it("sends only the kinds turned on, never what the person typed or Jane's replies", () => {
    const prefs = chatNotifyPrefs({});
    expect(notifiesKind(prefs, "decision")).toBe(true);
    expect(notifiesKind(prefs, "heads_up")).toBe(true);
    expect(notifiesKind(prefs, "done")).toBe(true);
    expect(notifiesKind(prefs, "brief")).toBe(false);
    expect(notifiesKind(prefs, "reply")).toBe(false);
    expect(notifiesKind(prefs, "user")).toBe(false);
    expect(notifiesKind(chatNotifyPrefs({ kinds: { brief: true } }), "brief")).toBe(true);
  });

  it("sends nothing when turned off", () => {
    expect(notifiesKind(chatNotifyPrefs({ channel: "off" }), "decision")).toBe(false);
  });
});

describe("withoutChatEmails", () => {
  it("stops emails and keeps phone notifications", () => {
    const of = (channel: string) => withoutChatEmails(chatNotifyPrefs({ channel })).channel;
    expect(of("both")).toBe("push");
    expect(of("email")).toBe("off");
    // With push, emails only came because no device had notifications on.
    expect(of("push")).toBe("off");
    expect(of("off")).toBe("off");
  });
});
