import type { ClientEventName } from "@/lib/analytics-events";

export function sendEvent(name: ClientEventName): void {
  // keepalive lets the request finish even if the user navigates away right after.
  fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
    keepalive: true,
  }).catch(() => {});
}
