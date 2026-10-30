"use client";

import { useEffect } from "react";

// The end of the chat: the page scrolled to its bottom. Not scrollIntoView on the message box:
// it's pinned to the bottom edge (sticky), so the browser counts it as in view already and
// barely scrolls (night QA 10-30: the chat opened at its oldest messages, 104 px of 2,533).
export function scrollChatToEnd() {
  window.scrollTo({ top: document.documentElement.scrollHeight });
}

// Opens the chat at the newest message, like any chat (spec step 81). A link to one message
// (/chat#<id>, from a notification, spec step 85) opens at that message instead.
export function ScrollToEnd({ targetId }: { targetId: string }) {
  useEffect(() => {
    const linked = window.location.hash.slice(1);
    const message = linked ? document.getElementById(decodeURIComponent(linked)) : null;
    if (message) message.scrollIntoView({ block: "start" });
    else if (document.getElementById(targetId)) scrollChatToEnd();
  }, [targetId]);
  return null;
}
