import {
  CHAT_NOTIFY_CHANNELS,
  CHAT_NOTIFY_KINDS,
  DEFAULT_CHAT_NOTIFY_CHANNEL,
  DEFAULT_CHAT_NOTIFY_KINDS,
  type ChatNotifyChannel,
  type ChatNotifyKind,
} from "@/config/chat-notify";

// The person's choices for Jane's messages as notifications (spec step 85), stored in
// users.chat_notify_prefs. Anything missing or unrecognised falls back to the defaults.

export type ChatNotifyPrefs = {
  channel: ChatNotifyChannel;
  kinds: Record<ChatNotifyKind, boolean>;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function chatNotifyPrefs(saved: unknown): ChatNotifyPrefs {
  const raw = isObject(saved) ? saved : {};
  const channel = (CHAT_NOTIFY_CHANNELS as readonly unknown[]).includes(raw.channel)
    ? (raw.channel as ChatNotifyChannel)
    : DEFAULT_CHAT_NOTIFY_CHANNEL;
  const savedKinds = isObject(raw.kinds) ? raw.kinds : {};
  const kinds = { ...DEFAULT_CHAT_NOTIFY_KINDS };
  for (const kind of CHAT_NOTIFY_KINDS) {
    if (typeof savedKinds[kind] === "boolean") kinds[kind] = savedKinds[kind];
  }
  return { channel, kinds };
}

// Whether a message of this kind goes out at all.
export function notifiesKind(prefs: ChatNotifyPrefs, kind: string): boolean {
  return (
    prefs.channel !== "off" &&
    (CHAT_NOTIFY_KINDS as readonly string[]).includes(kind) &&
    prefs.kinds[kind as ChatNotifyKind]
  );
}

// "Stop these emails" from an email: email off, phone notifications kept. With "push",
// emails only came because no device had notifications on, so it's off altogether.
export function withoutChatEmails(prefs: ChatNotifyPrefs): ChatNotifyPrefs {
  return { ...prefs, channel: prefs.channel === "both" ? "push" : "off" };
}
