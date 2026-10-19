import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { CHAT_PUSH_BODY_LENGTH } from "@/config/chat-notify";
import { chatNotifyPrefs } from "./notify-prefs";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  chatPushMessage,
  chooseToNotify,
  notificationButtons,
  queueChatNotifications,
  trimBody,
} from "./notify";

// Spec step 85: which messages go out, and what a push notification carries.

const NOW = new Date("2026-10-18T16:00:00Z");

function message(overrides: Partial<Parameters<typeof chatPushMessage>[0]> = {}) {
  return {
    id: "m1",
    kind: "decision",
    body: "You paid $35 in overdraft fees. Want me to ask for them back?",
    refs: { findingId: "f1" },
    actions: [
      { id: "finding.yes", label: "Yes", kind: "primary" },
      { id: "finding.pick", label: "Switch to Ally", kind: "primary" },
      { id: "finding.no", label: "Not now", kind: "secondary" },
      { id: "open", label: "Open", kind: "link", href: "/report/f1" },
    ],
    createdAt: NOW,
    notifiedVia: null,
    ...overrides,
  };
}

describe("chatPushMessage", () => {
  it("is titled Jane, says the message and opens it in the chat", () => {
    expect(chatPushMessage(message(), NOW)).toEqual({
      title: "Jane",
      body: "You paid $35 in overdraft fees. Want me to ask for them back?",
      url: "/chat#m1",
      tag: "jane-m1",
      messageId: "m1",
      // The first two buttons; never a link.
      actions: [
        { action: "finding.yes", title: "Yes" },
        { action: "finding.pick", title: "Switch to Ally" },
      ],
    });
  });

  it("leaves out an Undo whose time is up", () => {
    const done = message({
      kind: "done",
      refs: { undoUntil: "2026-10-18T15:00:00Z" },
      actions: [
        { id: "undo.rule", label: "Undo", kind: "secondary" },
        { id: "open", label: "Open", kind: "link", href: "/plan" },
      ],
    });
    expect(chatPushMessage(done, NOW).actions).toEqual([]);
    expect(notificationButtons(done, new Date("2026-10-18T14:00:00Z"))).toHaveLength(1);
  });
});

describe("trimBody", () => {
  it("keeps short text and cuts long text at a word", () => {
    expect(trimBody("Good morning!\nSafe to spend: $420.")).toBe(
      "Good morning! Safe to spend: $420.",
    );
    const long = "word ".repeat(100);
    const cut = trimBody(long);
    expect(cut.length).toBeLessThanOrEqual(CHAT_PUSH_BODY_LENGTH);
    expect(cut).toMatch(/word…$/);
  });
});

describe("queueChatNotifications", () => {
  it("sends nothing while the person is looking at the chat", async () => {
    const client = { user: { findUnique: vi.fn() } } as unknown as PrismaClient;
    expect(await queueChatNotifications("u1", { client, trigger: "open" })).toBeNull();
    expect(client.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("chooseToNotify", () => {
  const messages = [
    message({ id: "decision" }),
    message({ id: "brief", kind: "brief" }),
    message({ id: "heads-up", kind: "heads_up", refs: { deadlineKey: "d1" } }),
    message({ id: "alert", kind: "heads_up", refs: { alertId: "a1" } }),
    message({ id: "done", kind: "done" }),
    message({ id: "reply", kind: "reply" }),
    message({ id: "user", kind: "user" }),
  ];
  const ids = (prefs: unknown) => chooseToNotify(messages, chatNotifyPrefs(prefs)).map((m) => m.id);

  it("sends decisions, heads-ups and what Jane did; the brief only when asked", () => {
    expect(ids({})).toEqual(["decision", "heads-up", "done"]);
    expect(ids({ kinds: { brief: true } })).toEqual(["decision", "brief", "heads-up", "done"]);
  });

  it("never sends a message about an alert: alerts have their own delivery", () => {
    expect(ids({ kinds: { brief: true } })).not.toContain("alert");
  });

  it("stops a kind turned off, and everything when off", () => {
    expect(ids({ kinds: { decision: false } })).toEqual(["heads-up", "done"]);
    expect(ids({ channel: "off" })).toEqual([]);
  });
});
