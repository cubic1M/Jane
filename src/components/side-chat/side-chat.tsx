"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SIDE_CHAT_MIN_WIDTH_PX, UNREAD_POLL_MS } from "@/config/side-chat";
import {
  openedChat,
  isFrameMessage,
  panelShowsOn,
  sheetShare,
  snapSheet,
  type FrameMessage,
} from "@/lib/side-chat";
import { JaneAvatar } from "./avatar";
import { sideChatStore } from "./store";

// The side chat (docs/design/home-hub.md). On a computer the chat is docked on the right of
// every signed-in page; it folds to a slim rail with an unread dot and opens over the whole
// window. On a phone it is a bottom sheet opened from the Jane button: half height, dragged to
// full, swiped down to close. Either way it is the chat page itself (/chat?embed=1) in a frame,
// so it works exactly like the chat. It lives in the root layout, so changing tab never
// reloads it, and shows only on signed-in pages, once an app header has said who is signed in.

const useSideChat = () =>
  useSyncExternalStore(sideChatStore.subscribe, sideChatStore.get, sideChatStore.server);

const WIDE = `(min-width: ${SIDE_CHAT_MIN_WIDTH_PX}px)`;
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

// Inside a frame (the chat in the panel is a page too) there is never a second panel.
const useFramed = () =>
  useSyncExternalStore(
    () => () => {},
    () => window.self !== window.top,
    () => true,
  );

// Says who is signed in on this page, from the app header (which already looked them up).
export function SideChatUser({ userId }: { userId: string }) {
  useEffect(() => sideChatStore.register(userId), [userId]);
  return null;
}

const ICON_BUTTON =
  "inline-flex size-11 shrink-0 items-center justify-center text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";

function Icon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="square"
      className="size-5"
    >
      <path d={path} />
    </svg>
  );
}
const EXPAND = "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7";
const DOCK = "M4 10h6V4M20 14h-6v6M10 10 3 3M14 14l7 7";
const COLLAPSE = "M9 5l7 7-7 7";
const CLOSE = "M6 6l12 12M18 6 6 18";

function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      data-unread-dot
      className="absolute top-1.5 right-1.5 size-2.5 bg-amber-500 ring-2 ring-white dark:ring-zinc-950"
    />
  );
}

export function SideChat() {
  const { userId, panel, sheet, unread, src } = useSideChat();
  const pathname = usePathname();
  const router = useRouter();
  const wide = useWide();
  const framed = useFramed();
  const shows = !!userId && !framed && panelShowsOn(pathname);
  // The chat itself is in view (not folded to the rail, not a closed sheet).
  const inView = shows && (wide ? panel !== "rail" : sheet !== "closed");
  // The frame loads once the page is idle, and stays loaded after that.
  const [idle, setIdle] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const sheetBox = useRef<HTMLDivElement>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const sheetClose = useRef<HTMLButtonElement>(null);
  const drag = useRef<{
    startY: number;
    startShare: number;
    share: number;
    lastY: number;
    lastT: number;
    velocity: number;
  } | null>(null);
  const mountFrame = idle && shows && (inView || loaded);
  // Opened from a /chat link (src/lib/side-chat.ts): the chat comes into view showing what the
  // link asked for, and the address is tidied so a reload doesn't open it again.
  const search = useSearchParams();
  useEffect(() => {
    const opened = openedChat(window.location.search, window.location.hash);
    if (!opened) return;
    sideChatStore.openChat(opened.src);
    window.history.replaceState(null, "", `${window.location.pathname}${opened.address}`);
  }, [pathname, search]);

  const post = (message: FrameMessage) =>
    frame.current?.contentWindow?.postMessage(message, window.location.origin);
  const where: FrameMessage = {
    type: "jane:panel",
    state: wide ? panel : "sheet",
    home: pathname === "/home",
  };
  // The latest, for the frame's "ready" (which can arrive between renders).
  const whereRef = useRef(where);
  useEffect(() => {
    whereRef.current = where;
  });

  useEffect(() => {
    const ready = () => setIdle(true);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(ready, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(ready, 300);
    return () => clearTimeout(id);
  }, []);

  // The room beside the page (src/app/globals.css) follows the panel.
  // Until someone is known to be signed in, the CSS default (docked) stands.
  useEffect(() => {
    if (!userId) return;
    document.documentElement.dataset.sideChat = shows ? panel : "none";
  }, [userId, shows, panel]);

  // The framed chat asks the page to open a link: in the main window, not the panel.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frame.current?.contentWindow) return;
      if (!isFrameMessage(event.data)) return;
      if (event.data.type === "jane:ready") {
        listening.current = true;
        post(whereRef.current);
        if (asking.current) post({ type: "jane:ask", text: asking.current });
        asking.current = null;
        if (sending.current) post({ type: "jane:send", text: sending.current });
        sending.current = null;
        return;
      }
      // Where a question sent from the giant tree landed, in the page's coordinates, and when
      // Jane starts and finishes: told to the page for its dotted line.
      if (event.data.type === "jane:bubble") {
        const r = frame.current?.getBoundingClientRect();
        if (r) {
          window.dispatchEvent(
            new CustomEvent("jane:bubble", {
              detail: { x: r.left + event.data.x, y: r.top + event.data.y },
            }),
          );
        }
        return;
      }
      // Where the message box is once a question waits in it, for the home hub's dotted line.
      if (event.data.type === "jane:box") {
        const r = frame.current?.getBoundingClientRect();
        if (r) {
          window.dispatchEvent(
            new CustomEvent("jane:box", {
              detail: { x: r.left + event.data.x, y: r.top + event.data.y },
            }),
          );
        }
        return;
      }
      if (event.data.type === "jane:answering" || event.data.type === "jane:answered") {
        window.dispatchEvent(new Event(event.data.type));
        return;
      }
      if (event.data.type !== "jane:navigate") return;
      router.push(event.data.href);
      if (!wide) sideChatStore.setSheet("closed");
      else if (sideChatStore.get().panel === "full") sideChatStore.setPanel("open");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router, wide]);

  // "Ask Jane" from the giant tree: the chat comes into view and the question is sent at once,
  // waiting for the framed chat if it isn't listening yet; asked before, it finds the answer.
  const sending = useRef<string | null>(null);
  // The framed chat said it's listening (its "ready"); a new page in the frame says it again.
  const listening = useRef(false);
  useEffect(() => {
    const onSend = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      if (typeof text !== "string" || !text) return;
      if (wide) {
        if (sideChatStore.get().panel === "rail") sideChatStore.setPanel("open");
      } else sideChatStore.setSheet("half");
      // Only once the framed chat is listening (loaded isn't enough: it may still be hydrating).
      if (listening.current) post({ type: "jane:send", text });
      else sending.current = text;
    };
    const onFind = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      if (typeof text !== "string" || !text) return;
      if (wide) {
        if (sideChatStore.get().panel === "rail") sideChatStore.setPanel("open");
      } else sideChatStore.setSheet("half");
      if (listening.current) post({ type: "jane:find", text });
    };
    window.addEventListener("jane:send", onSend);
    window.addEventListener("jane:find", onFind);
    return () => {
      window.removeEventListener("jane:send", onSend);
      window.removeEventListener("jane:find", onFind);
    };
  }, [wide, loaded]);

  // "Ask Jane about this" (the feature map): the chat comes into view with the question in its
  // message box, waiting for the framed chat if it isn't listening yet.
  const asking = useRef<string | null>(null);
  useEffect(() => {
    const onAsk = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      if (typeof text !== "string" || !text) return;
      if (wide) {
        if (sideChatStore.get().panel === "rail") sideChatStore.setPanel("open");
      } else sideChatStore.setSheet("half");
      if (loaded) post({ type: "jane:ask", text });
      else asking.current = text;
    };
    window.addEventListener("jane:ask", onAsk);
    return () => window.removeEventListener("jane:ask", onAsk);
  }, [wide, loaded]);

  // Tell the framed chat where it is (docked, full or a sheet).
  useEffect(() => {
    if (loaded) post(where);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, wide, panel, pathname]);

  // Out of sight, the unread dot is checked on focus and every minute.
  useEffect(() => {
    if (!shows || inView) return;
    let stopped = false;
    const check = async () => {
      try {
        const response = await fetch("/api/chat/unread", { cache: "no-store" });
        if (!response.ok) return;
        const { unread: count } = (await response.json()) as { unread: number };
        if (!stopped) sideChatStore.setUnread(count);
      } catch {
        // Offline or signed out: keep the dot as it was.
      }
    };
    void check();
    const timer = setInterval(check, UNREAD_POLL_MS);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [shows, inView]);

  // Back in view with something new: the framed chat reloads its messages (and so reads them).
  useEffect(() => {
    if (!inView || sideChatStore.get().unread === 0) return;
    if (loaded) post({ type: "jane:refresh" });
    sideChatStore.setUnread(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

  // Escape docks the full panel, or closes the sheet.
  useEffect(() => {
    if (!shows) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (wide && panel === "full") sideChatStore.setPanel("open");
      else if (!wide && sheet !== "closed") sideChatStore.setSheet("closed");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shows, wide, panel, sheet]);

  // The sheet is a dialog: focus goes into it, and back to the Jane button when it closes.
  const sheetOpen = !wide && sheet !== "closed";
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wide || !shows) return;
    if (sheetOpen && !wasOpen.current) sheetClose.current?.focus();
    if (!sheetOpen && wasOpen.current) fab.current?.focus();
    wasOpen.current = sheetOpen;
  }, [sheetOpen, wide, shows]);

  if (!shows) return null;

  const iframe = mountFrame && (
    <iframe
      ref={frame}
      src={src}
      title="Chat with Jane"
      onLoad={() => {
        setLoaded(true);
        post(where);
      }}
      className="min-h-0 w-full flex-1 border-0 bg-white dark:bg-zinc-950"
    />
  );
  const placeholder = !mountFrame && (
    <p className="flex-1 p-4 text-sm text-zinc-500" aria-live="polite">
      Opening the chat…
    </p>
  );

  if (wide) {
    return (
      <aside
        aria-label="Chat with Jane"
        data-side-chat={panel}
        className="side-chat fixed right-0 bottom-0 z-40 flex flex-col border-l border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950 print:hidden"
      >
        {panel === "rail" ? (
          <button
            type="button"
            onClick={() => sideChatStore.setPanel("open")}
            className="relative flex h-full w-full flex-col items-center gap-3 pt-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <JaneAvatar />
            <UnreadDot count={unread} />
            {/* Its name is its text: "Open chat", and how many are new. */}
            <span className="sr-only">{unread > 0 ? `Open chat, ${unread} new` : "Open chat"}</span>
            <span
              aria-hidden
              className="text-xs font-medium text-zinc-600 [writing-mode:vertical-rl] dark:text-zinc-400"
            >
              Chat with Jane
            </span>
          </button>
        ) : (
          <>
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-300 pl-3 dark:border-zinc-700">
              <JaneAvatar />
              <p className="flex-1 text-sm font-semibold">Jane</p>
              {panel === "full" ? (
                <button
                  type="button"
                  aria-label="Dock chat"
                  onClick={() => sideChatStore.setPanel("open")}
                  className={ICON_BUTTON}
                >
                  <Icon path={DOCK} />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Expand chat"
                  onClick={() => sideChatStore.setPanel("full")}
                  className={ICON_BUTTON}
                >
                  <Icon path={EXPAND} />
                </button>
              )}
              <button
                type="button"
                aria-label="Collapse chat"
                onClick={() => sideChatStore.setPanel("rail")}
                className={ICON_BUTTON}
              >
                <Icon path={COLLAPSE} />
              </button>
            </div>
          </>
        )}
        {/* Kept in the page while folded, so opening it again is instant. */}
        <div className={panel === "rail" ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
          {iframe}
          {placeholder}
        </div>
      </aside>
    );
  }

  // The phone: the Jane button, and the sheet over the page.
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const share = sheetShare(sheet);
    drag.current = {
      startY: event.clientY,
      startShare: share,
      share,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
    };
    sheetBox.current?.setAttribute("data-dragging", "");
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const share = Math.min(
      sheetShare("full"),
      Math.max(0, d.startShare + (d.startY - event.clientY) / window.innerHeight),
    );
    const dt = event.timeStamp - d.lastT;
    if (dt > 0) d.velocity = (event.clientY - d.lastY) / dt;
    d.share = share;
    d.lastY = event.clientY;
    d.lastT = event.timeStamp;
    sheetBox.current?.style.setProperty("--sheet-share", String(share));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    sheetBox.current?.removeAttribute("data-dragging");
    sheetBox.current?.style.removeProperty("--sheet-share");
    if (!d) return;
    // A tap on the handle (no real move) goes from half to full and back.
    if (Math.abs(d.share - d.startShare) < 0.02) {
      sideChatStore.setSheet(sheet === "full" ? "half" : "full");
      return;
    }
    sideChatStore.setSheet(snapSheet(d.share, d.velocity));
  };

  return (
    <>
      <button
        ref={fab}
        id="jane-fab"
        type="button"
        aria-expanded={sheetOpen}
        aria-haspopup="dialog"
        onClick={() => sideChatStore.setSheet("half")}
        className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex size-14 items-center justify-center border-2 border-emerald-800 bg-emerald-700 text-white shadow-lg hover:bg-emerald-800 print:hidden"
      >
        <span aria-hidden className="text-lg font-bold">
          J_
        </span>
        {/* Its name is its text, so it matches what speech users say. */}
        <span className="sr-only">
          {unread > 0 ? `Chat with Jane, ${unread} new` : "Chat with Jane"}
        </span>
        <UnreadDot count={unread} />
      </button>
      <div
        aria-hidden
        data-open={sheetOpen ? "" : undefined}
        onClick={() => sideChatStore.setSheet("closed")}
        className="side-chat-scrim fixed inset-0 z-40 bg-zinc-950/40"
      />
      <div
        ref={sheetBox}
        role="dialog"
        aria-modal="true"
        aria-label="Chat with Jane"
        aria-hidden={!sheetOpen}
        inert={!sheetOpen}
        data-sheet={sheet}
        className="side-chat-sheet fixed inset-x-0 bottom-0 z-50 flex flex-col border-t-2 border-emerald-700 bg-white shadow-2xl dark:bg-zinc-950"
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2 select-none"
        >
          <span aria-hidden className="h-1.5 w-12 bg-zinc-300 dark:bg-zinc-700" />
          <div className="flex w-full items-center gap-2 pl-3">
            <JaneAvatar />
            <p className="flex-1 text-sm font-semibold">Jane</p>
            <button
              type="button"
              aria-label={sheet === "full" ? "Shrink chat" : "Expand chat"}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => sideChatStore.setSheet(sheet === "full" ? "half" : "full")}
              className={ICON_BUTTON}
            >
              <Icon path={sheet === "full" ? DOCK : EXPAND} />
            </button>
            <button
              ref={sheetClose}
              type="button"
              aria-label="Close chat"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => sideChatStore.setSheet("closed")}
              className={ICON_BUTTON}
            >
              <Icon path={CLOSE} />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-300 dark:border-zinc-700">
          {iframe}
          {placeholder}
        </div>
      </div>
    </>
  );
}
