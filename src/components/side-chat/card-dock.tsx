"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SuggestionCards } from "@/app/chat/suggestion-cards";
import { CARDS_CHANGED_EVENT, UNREAD_POLL_MS } from "@/config/side-chat";
import { keepWheel } from "@/lib/contain-scroll";
import {
  goneIds,
  goneServerSnapshot,
  goneSnapshot,
  skipParam,
  subscribeGone,
  withoutGone,
} from "@/lib/dock-gone";
import type { MessageView } from "@/lib/jane-agent/view";

// The card dock (founder: "I want them right above the chat on the right (but not in the
// chat), also slightly bigger so that the info isn't all gone"): on a computer, Jane's cards
// sit in the right column directly above the side chat, one at a time with "+N" and arrows,
// never in the chat's own list. It loads them itself (/api/chat/cards), on every page, again on
// a new page, on focus, every minute, and after an answer. Nothing to show, it takes no room.
// The last cards are kept for the tab's session, so a reload paints them at once and the chat
// under them never jumps down; the first time, the dock slides open instead (reviewer polish).

const KEPT = "jane:dock-cards";

// Never one the person has dealt with since (answered or followed: src/lib/dock-gone.ts).
export function keptCards(
  storage: Pick<Storage, "getItem"> | undefined,
  gone: readonly string[] = [],
): MessageView[] {
  try {
    const kept = JSON.parse(storage?.getItem(KEPT) ?? "[]");
    return Array.isArray(kept) ? withoutGone(kept, gone) : [];
  } catch {
    return [];
  }
}

function keepCards(cards: readonly MessageView[]) {
  try {
    window.sessionStorage.setItem(KEPT, JSON.stringify(withoutGone(cards, goneIds())));
  } catch {
    // Private window or storage blocked: the dock just loads them again.
  }
}

const sessionStore = () => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

export function CardDock() {
  const pathname = usePathname();
  // The cards the tab last showed, at once, so nothing moves when they load. The docked panel
  // only renders in the browser (useWide is false on the server), so this never mismatches.
  const [kept] = useState(() => keptCards(sessionStore(), goneIds()));
  const [cards, setCards] = useState<MessageView[]>(kept);
  // Kept cards paint in place; a dock that appears later slides open.
  const [fromKept, setFromKept] = useState(kept.length > 0);

  // The card showing now: a reload never takes it away while the person is on it (founder: "the
  // suggestion itself disappears"); it goes when they answer it or step off it.
  const showing = useRef<string | null>(null);
  const onShowing = useCallback((id: string | null) => {
    showing.current = id;
  }, []);

  const loaded = useRef(false);
  const load = useCallback(async () => {
    try {
      // Without the ones just dealt with: their answers may not have reached the server yet.
      const skip = skipParam(goneIds());
      const response = await fetch(
        skip ? `/api/chat/cards?skip=${encodeURIComponent(skip)}` : "/api/chat/cards",
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const body = (await response.json()) as { cards?: MessageView[] };
      // The first answer replaces the kept cards outright: one may have been answered since.
      const first = !loaded.current;
      loaded.current = true;
      setFromKept(false);
      setCards((now) => {
        const next = first
          ? (body.cards ?? [])
          : keepShowing(now, body.cards ?? [], showing.current, goneIds());
        keepCards(next);
        return next;
      });
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
    // The framed chat reloaded with different cards (after an upload, say).
    window.addEventListener(CARDS_CHANGED_EVENT, run);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", run);
      window.removeEventListener(CARDS_CHANGED_EVENT, run);
    };
  }, [load, pathname]);

  // One dealt with goes from the dock at once, and from the kept copy.
  const gone = useSyncExternalStore(subscribeGone, goneSnapshot, goneServerSnapshot);
  const shown = withoutGone(cards, gone.split(","));
  useEffect(() => {
    if (gone) keepCards(cards);
  }, [gone, cards]);

  // The dock is the one scroller for a card and its details: the wheel, a trackpad or the keys
  // move it from anywhere over the card, and at its end the page and the chat behind stay put.
  const scroller = useRef<HTMLDivElement>(null);
  const hasCards = shown.length > 0;
  useEffect(() => {
    const box = scroller.current;
    if (!hasCards || !box) return;
    return keepWheel(box);
  }, [hasCards]);

  if (shown.length === 0) return null;
  return (
    <FollowHeight
      className="shrink-0 border-b border-zinc-300 dark:border-zinc-700"
      slideIn={!fromKept}
    >
      <div
        ref={scroller}
        data-dock-scroll=""
        // Focusable, so the arrow keys, Page Down and Space scroll it (its header's arrows still
        // step between cards while the header has focus).
        tabIndex={0}
        role="region"
        aria-label="Jane's suggestions, scrollable"
        className="max-h-[50vh] overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-zinc-500"
      >
        {/* One stack for good: a reload updates it in place, never starting it over. */}
        <SuggestionCards
          messages={shown}
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
  gone: readonly string[] = [],
): MessageView[] {
  // One the person dealt with is never kept, nor let back in by a load that crossed its answer.
  if (shown && gone.includes(shown)) return withoutGone(after, gone);
  if (!shown || after.some((c) => c.id === shown)) return withoutGone(after, gone);
  const at = before.findIndex((c) => c.id === shown);
  if (at < 0) return withoutGone(after, gone);
  const out = withoutGone(after, gone);
  out.splice(Math.min(at, out.length), 0, before[at]);
  return out;
}

// Its height follows what's inside, smoothly (a card opening, or the next card being taller),
// so the chat under it never jumps.
// Appearing from nothing, it opens from no height rather than pushing the chat down in one go.
function FollowHeight({
  className,
  slideIn,
  children,
}: {
  className: string;
  slideIn: boolean;
  children: React.ReactNode;
}) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(slideIn ? 0 : null);
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
