"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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

  // The card showing now: a reload never takes it away while the person is on it (founder: "the
  // suggestion itself disappears"); it goes when they answer it or step off it.
  const showing = useRef<string | null>(null);
  const onShowing = useCallback((id: string | null) => {
    showing.current = id;
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/chat/cards", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { cards?: MessageView[] };
      setCards((now) => keepShowing(now, body.cards ?? [], showing.current));
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
    <FollowHeight className="shrink-0 border-b border-zinc-300 dark:border-zinc-700">
      <div className="max-h-[50vh] overflow-y-auto overscroll-contain">
        {/* One stack for good: a reload updates it in place, never starting it over. */}
        <SuggestionCards
          messages={cards}
          docked
          onAnswered={() => void load()}
          onShowing={onShowing}
        />
      </div>
    </FollowHeight>
  );
}

// The reloaded cards, with the one showing kept in its place if the reload left it out.
export function keepShowing(
  before: readonly MessageView[],
  after: readonly MessageView[],
  shown: string | null,
): MessageView[] {
  if (!shown || after.some((c) => c.id === shown)) return [...after];
  const at = before.findIndex((c) => c.id === shown);
  if (at < 0) return [...after];
  const out = [...after];
  out.splice(Math.min(at, out.length), 0, before[at]);
  return out;
}

// Its height follows what's inside, smoothly (a card opening, or the next card being taller),
// so the chat under it never jumps.
function FollowHeight({ className, children }: { className: string; children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => setHeight(el.offsetHeight));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <div
      className={`dock-height overflow-hidden ${className}`}
      style={height === null ? undefined : { height }}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}
