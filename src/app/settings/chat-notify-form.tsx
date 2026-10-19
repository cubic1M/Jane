"use client";

import { useActionState } from "react";
import type { ChatNotifyChannel, ChatNotifyKind } from "@/config/chat-notify";
import type { SettingsState } from "./actions";
import { saveChatNotifyPreferences } from "./chat-notify-actions";

// "Messages from Jane" (spec step 85): how they reach the person, and which kinds.

const CHANNELS: Record<ChatNotifyChannel, string> = {
  push: "Phone notifications (by email until you turn them on)",
  email: "Email",
  both: "Phone notifications and email",
  off: "Off: only in the app",
};

export function ChatNotifyForm({
  channel,
  kinds,
}: {
  channel: ChatNotifyChannel;
  kinds: { kind: ChatNotifyKind; label: string; on: boolean }[];
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    saveChatNotifyPreferences,
    null,
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        How Jane reaches you
        <select
          name="channel"
          defaultValue={channel}
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base sm:max-w-md dark:border-zinc-700"
        >
          {(Object.keys(CHANNELS) as ChatNotifyChannel[]).map((c) => (
            <option key={c} value={c}>
              {CHANNELS[c]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Which messages</legend>
        {kinds.map((k) => (
          <label key={k.kind} className="flex min-h-11 items-center gap-3">
            <input type="checkbox" name={k.kind} defaultChecked={k.on} className="h-5 w-5" />
            {k.label}
          </label>
        ))}
      </fieldset>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "text-emerald-700" : "text-red-700"}
        >
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
