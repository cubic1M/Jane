import { PostHog } from "posthog-node";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { isTrialUser } from "@/lib/trial-ids";

export type EventProperties = Record<string, string | number | boolean | null>;

// What stays in our own table and never goes to PostHog: an event's name alone can say someone has a
// medical bill, identity theft, money trouble or a loss, and a bank's name is an account detail
// (/privacy: "Never your email, your account details or your transactions").
const KEPT_FROM_POSTHOG =
  /^(?:medical_|health_|tax_identity_|tight_|disaster_|life_event_|credit_dispute|debt_|benefit)/;
const PROPERTIES_KEPT_FROM_POSTHOG = ["institution"];

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
  if (!client || KEPT_FROM_POSTHOG.test(name)) return;

  const anonymousId = properties.anonymous_id;
  const distinctId = userId ?? (typeof anonymousId === "string" ? anonymousId : "anonymous");
  try {
    await client.captureImmediate({
      distinctId,
      event: name,
      properties: Object.fromEntries(
        Object.entries(properties).filter(([key]) => !PROPERTIES_KEPT_FROM_POSTHOG.includes(key)),
      ),
    });
  } catch (error) {
    // The database row is the source of truth; a PostHog outage must not fail the request.
    log.error("PostHog capture failed", { event: name, error });
  }
}

export function resetAnalyticsForTests(): void {
  posthog = undefined;
}
