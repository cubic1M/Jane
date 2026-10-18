import type { ClientEventName } from "@/lib/analytics-events";

// findingId is the only property the server accepts, for card_opened.
export function sendEvent(name: ClientEventName, findingId?: string): void {
  // keepalive lets the request finish even if the user navigates away right after.
  fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, ...(findingId ? { findingId } : {}) }),
    keepalive: true,
  }).catch(() => {});
}
