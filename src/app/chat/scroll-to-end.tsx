"use client";

import { useEffect } from "react";

// Opens the chat at the newest message, like any chat (spec step 81). The target keeps a
// scroll margin as tall as the phone tab bar, so the bar never covers it.
export function ScrollToEnd({ targetId }: { targetId: string }) {
  useEffect(() => {
    document.getElementById(targetId)?.scrollIntoView({ block: "end" });
  }, [targetId]);
  return null;
}
