"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SuggestionCards } from "@/app/chat/suggestion-cards";
import { UNREAD_POLL_MS } from "@/config/side-chat";
import type { MessageView } from "@/lib/jane-agent/view";

// The card dock (founder: "I want them right above the chat on the right (but not in the
// chat), also slightly bigger so that the info isn't all gone"): on a computer, Jane's cards
// sit in the right column directly above the side chat, one at a time with "+N" and arrows,
// never in the chat's own list. It loads them itself (/api/chat/cards), on every page, again on
// a new page, on focus, every minute, and after an answer. Nothing to show, it takes no room.

export function CardDock() {
  const pathname = usePathname();
  const [cards, setCards] = useState<MessageView[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/chat/cards", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { cards?: MessageView[] };
      setCards(body.cards ?? []);
    } catch {
      // Offline for a moment: the cards stay as they were until the next load.
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    const run = () => {
      if (!stopped) void load();
    };
    run();
    const timer = setInterval(run, UNREAD_POLL_MS);
    window.addEventListener("focus", run);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", run);
    };
  }, [load, pathname]);

  if (cards.length === 0) return null;
  return (
    <div className="max-h-[75vh] shrink-0 overflow-y-auto overscroll-contain border-b border-zinc-300 dark:border-zinc-700">
      {/* A new set is a new stack: what was answered here is gone from it already. */}
      <SuggestionCards
        key={cards.map((c) => c.id).join(",")}
        messages={cards}
        docked
        onAnswered={() => void load()}
      />
    </div>
  );
}
