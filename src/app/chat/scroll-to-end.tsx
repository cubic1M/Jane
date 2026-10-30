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

// Opens the chat at the newest message, like any chat (spec step 81). A link to one message
// (/chat#<id>, from a notification, spec step 85) opens at that message instead. And it stays at
// the end while the chat's size changes under it, until the person scrolls up: the phone's sheet
// opening the frame from shut, Jane's card coming in over the end and the room kept for it
// (night debugger: on a phone the card covered the newest answer).
export function ScrollToEnd({ targetId }: { targetId: string }) {
  useEffect(() => {
    const linked = window.location.hash.slice(1);
    const message = linked ? document.getElementById(decodeURIComponent(linked)) : null;
    if (message) message.scrollIntoView({ block: "start" });
    else if (document.getElementById(targetId)) scrollChatToEnd();

    let stuck = !message;
    const keep = () => {
      if (stuck) scrollChatToEnd();
    };
    const onScroll = () => {
      stuck = atEnd(document.documentElement);
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
