import { ACTIVITY } from "@/config/activity";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { isTrialUser } from "@/lib/trial-ids";
import { anonymousOnly, sanitizeBatch, type ActivityRow } from "./sanitize";
import { systemDb } from "@/lib/system-db";
import { onlyDemoBank } from "@/lib/only-demo-bank";

// Who the beta's activity log records: real signed-in beta users. Never a trial person
// (sample data), an admin, or someone whose only bank is the demo bank; before sign-in, only
// anonymous views of the landing page.

export type Recording = "user" | "anonymous" | "none";

type Person = { id: string; role?: string | null } | null;
type Options = { client?: PrismaClient; now?: Date };

export async function recordingFor(
  person: Person,
  { client = defaultClient }: Options = {},
): Promise<Recording> {
  if (!person) return "anonymous";
  if (isTrialUser(person.id) || person.role === "admin") return "none";
  return (await onlyDemoBank(person.id, client)) ? "none" : "user";
}

// Stores what the browser sent, if this person is recorded. `recording` tells the browser
// whether to keep sending more than page views.
export async function recordActivity(
  person: Person,
  body: unknown,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ ok: false } | { ok: true; recording: Recording; stored: number }> {
  const batch = sanitizeBatch(body, now);
  if (!batch) return { ok: false };
  const recording = await recordingFor(person, { client });
  const rows: ActivityRow[] =
    recording === "user"
      ? batch.events
      : recording === "anonymous"
        ? anonymousOnly(batch.events).slice(0, ACTIVITY.maxAnonymousBatch)
        : [];
  if (rows.length > 0) {
    // Its own table, like analytics_events: written for the signed-in person only, read
    // across people only by the admin pages.
    await systemDb(
      "The activity log is written for whoever acted, rows for several people at once",
      client,
    ).activityEvent.createMany({
      data: rows.map((r) => ({
        ...r,
        userId: recording === "user" ? person!.id : null,
      })),
    });
  }
  return { ok: true, recording, stored: rows.length };
}
