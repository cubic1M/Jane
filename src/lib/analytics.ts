import { PostHog } from "posthog-node";
import { db } from "@/lib/db";
import { isTrialUser } from "@/lib/trial-ids";

export type EventProperties = Record<string, string | number | boolean | null>;

let posthog: PostHog | null | undefined;

function getPostHog(): PostHog | null {
  if (posthog === undefined) {
    const key = process.env.POSTHOG_KEY;
    posthog = key ? new PostHog(key, { host: process.env.POSTHOG_HOST }) : null;
  }
  return posthog;
}

export async function track(
  userId: string | null,
  name: string,
  properties: EventProperties = {},
): Promise<void> {
  // Spec step 138: people trying Jane with sample data are never counted.
  if (isTrialUser(userId)) return;
  await db.analyticsEvent.create({ data: { userId, name, properties } });

  const client = getPostHog();
  if (!client) return;

  const anonymousId = properties.anonymous_id;
  const distinctId = userId ?? (typeof anonymousId === "string" ? anonymousId : "anonymous");
  try {
    await client.captureImmediate({ distinctId, event: name, properties });
  } catch (error) {
    // The database row is the source of truth; a PostHog outage must not fail the request.
    console.error("PostHog capture failed", { event: name, error });
  }
}

export function resetAnalyticsForTests(): void {
  posthog = undefined;
}
