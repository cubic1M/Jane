import { track, type EventProperties } from "@/lib/analytics";
import { log } from "@/lib/log";

// For a write that has already been committed: a failed analytics row must not turn it into a
// failure the person retries (a second deadline, a plan restarted). The failure is logged.
export async function trackQuietly(
  userId: string | null,
  name: string,
  properties: EventProperties = {},
): Promise<void> {
  try {
    await track(userId, name, properties);
  } catch (error) {
    log.error("Analytics write failed after the change was saved", { event: name, error });
  }
}
