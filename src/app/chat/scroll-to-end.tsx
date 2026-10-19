"use client";

import { useEffect } from "react";

// Opens the chat at the newest message, like any chat (spec step 81). The target keeps a
// scroll margin as tall as the phone tab bar, so the bar never covers it. A link to one
// message (/chat#<id>, from a notification, spec step 85) opens at that message instead.
export function ScrollToEnd({ targetId }: { targetId: string }) {
  useEffect(() => {
    const linked = window.location.hash.slice(1);
    const message = linked ? document.getElementById(decodeURIComponent(linked)) : null;
    if (message) message.scrollIntoView({ block: "start" });
    else document.getElementById(targetId)?.scrollIntoView({ block: "end" });
  }, [targetId]);
  return null;
}
