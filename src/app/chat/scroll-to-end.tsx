"use client";

import { useEffect } from "react";

// The end of the chat: the page scrolled to its bottom. Not scrollIntoView on the message box:
// it's pinned to the bottom edge (sticky), so the browser counts it as in view already and
// barely scrolls (night QA 10-30: the chat opened at its oldest messages, 104 px of 2,533).
export function scrollChatToEnd() {
  window.scrollTo({ top: document.documentElement.scrollHeight });
}

// This close to the bottom counts as reading the newest message.
export const END_SLACK_PX = 48;

export function atEnd(
  {
    scrollTop,
    scrollHeight,
    clientHeight,
  }: Pick<Element, "scrollTop" | "scrollHeight" | "clientHeight">,
  slack = END_SLACK_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack;
}

// Still following the end: it was, and the person hasn't scrolled up since it last went there.
// Checked on the resize itself, not only from scroll events: a scroll up just before a resize
// (the sheet still sliding open) is only heard after it, and following then pulled the person
// back down (night debugger, 10-30).
export function stillFollowing(
  following: boolean,
  page: Pick<Element, "scrollTop" | "scrollHeight" | "clientHeight">,
  lastTop: number,
): boolean {
  return following && (atEnd(page) || page.scrollTop >= lastTop - 1);
}

// Opens the chat at the newest message, like any chat (spec step 81). A link to one message
// (/chat#<id>, from a notification, spec step 85) opens at that message instead. And it stays at
// the end while the chat's size changes under it, until the person scrolls up: the phone's sheet
// opening the frame from shut, Jane's card coming in over the end and the room kept for it
// (night debugger: on a phone the card covered the newest answer). The panel growing or
// shrinking beside a page too (src/app/chat/embed-bridge.tsx leaves it to this).
export function ScrollToEnd({ targetId }: { targetId: string }) {
  useEffect(() => {
    const linked = window.location.hash.slice(1);
    const message = linked ? document.getElementById(decodeURIComponent(linked)) : null;
    if (message) message.scrollIntoView({ block: "start" });
    else if (document.getElementById(targetId)) scrollChatToEnd();

    const page = document.documentElement;
    let stuck = !message;
    let lastTop = page.scrollTop;
    const keep = () => {
      stuck = stillFollowing(stuck, page, lastTop);
      if (!stuck) return;
      scrollChatToEnd();
      lastTop = page.scrollTop;
    };
    const onScroll = () => {
      stuck = atEnd(page);
      lastTop = page.scrollTop;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", keep);
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(keep);
    watch?.observe(document.body);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", keep);
      watch?.disconnect();
    };
  }, [targetId]);
  return null;
}
