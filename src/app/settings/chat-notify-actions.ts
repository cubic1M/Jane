"use server";

import { revalidatePath } from "next/cache";
import { CHAT_NOTIFY_CHANNELS, CHAT_NOTIFY_KINDS } from "@/config/chat-notify";
import { track } from "@/lib/analytics";
import { db } from "@/lib/db";
import { chatNotifyPrefs } from "@/lib/jane-agent/notify-prefs";
import { requireUser } from "@/lib/session";
import type { SettingsState } from "./actions";

// "Messages from Jane" in Settings (spec step 85): how Jane's messages reach the person
// (push, email, both or off) and which kinds go out. Takes effect at once: every
// notification checks these when it's sent.
export async function saveChatNotifyPreferences(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  const channel = String(formData.get("channel") ?? "");
  if (!(CHAT_NOTIFY_CHANNELS as readonly string[]).includes(channel)) {
    return { ok: false, message: "Pick how you'd like to hear from Jane." };
  }
  const prefs = chatNotifyPrefs({
    channel,
    kinds: Object.fromEntries(CHAT_NOTIFY_KINDS.map((k) => [k, formData.get(k) === "on"])),
  });
  await db.user.update({ where: { id: user.id }, data: { chatNotifyPrefs: prefs } });
  await track(user.id, "chat_notify_prefs_saved", {
    channel: prefs.channel,
    ...Object.fromEntries(CHAT_NOTIFY_KINDS.map((k) => [k, prefs.kinds[k]])),
  });
  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}
