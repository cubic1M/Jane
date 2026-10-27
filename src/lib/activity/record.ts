import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { isDemoItemId } from "@/lib/plaid/demo";
import { isTrialUser } from "@/lib/trial-ids";
import { anonymousOnly, sanitizeBatch, type ActivityRow } from "./sanitize";

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
  return (await isDemoBankOnly(person.id, client)) ? "none" : "user";
}

// Someone trying the demo bank: every account they have is the demo bank's.
async function isDemoBankOnly(userId: string, client: PrismaClient): Promise<boolean> {
  const db = scopedFor(userId, client);
  const [items, csvAccounts] = await Promise.all([
    db.plaidItems.findMany({ select: { plaidItemId: true } }),
    db.accounts.count({ where: { source: "csv" } }),
  ]);
  return items.length > 0 && csvAccounts === 0 && items.every((i) => isDemoItemId(i.plaidItemId));
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
        ? anonymousOnly(batch.events)
        : [];
  if (rows.length > 0) {
    // Its own table, like analytics_events: written for the signed-in person only, read
    // across people only by the admin pages.
    await client.activityEvent.createMany({
      data: rows.map((r) => ({
        ...r,
        userId: recording === "user" ? person!.id : null,
      })),
    });
  }
  return { ok: true, recording, stored: rows.length };
}
