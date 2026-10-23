"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { panelShowsOn } from "@/lib/side-chat";
import { sideChatStore } from "./store";

// The top bar's Chat button on a computer: shows or folds the docked chat. On a phone the Jane
// button does this, and on the chat's own page there's nothing to show.
export function ChatToggle() {
  const { panel, unread } = useSyncExternalStore(
    sideChatStore.subscribe,
    sideChatStore.get,
    sideChatStore.server,
  );
  if (!panelShowsOn(usePathname())) return null;
  const folded = panel === "rail";
  return (
    <button
      type="button"
      aria-pressed={!folded}
      onClick={() => sideChatStore.setPanel(folded ? "open" : "rail")}
      className="relative hidden min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 lg:inline-flex dark:text-zinc-300 dark:hover:bg-zinc-900"
    >
      <span aria-hidden className="text-xs text-emerald-700">
        &gt;_
      </span>
      Chat
      {folded && unread > 0 && (
        <span aria-label={`${unread} new`} className="size-2 bg-amber-500" />
      )}
    </button>
  );
}
