"use client";

import { useEffect, useRef } from "react";
import { sendEvent } from "@/lib/analytics-client";
import type { ClientEventName } from "@/lib/analytics-events";

// Sends one page-view event when the page is shown.
export function ViewTracker({ event, findingId }: { event: ClientEventName; findingId?: string }) {
  // Strict Mode runs effects twice in dev; the ref keeps it to one event.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    sendEvent(event, findingId);
  }, [event, findingId]);

  return null;
}
