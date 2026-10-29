import { CHAT_PRIMER_STORED_MINUTES } from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { sameData } from "@/lib/data-stamp";
import { isoDay } from "@/lib/dates";
import { staleAndRefreshSnapshot } from "./snapshot-store";

// The person's numbers for Claude, kept in the database (spec step 93, depth first): computing
// them looks every sector up (20 seconds or more on a slow database), so it is done after each
// sync, scan and correction and saved as one row; the chat reads that row in one query and
// refreshes it in the background once it is stale. One jane_preferences row (kind "system"),
// which Settings does not list.

type Primer = { text: string; cents: number[] };
type Options = { client: PrismaClient; now: Date };

const KEY = "primer";

// stamp: the data the numbers were worked out from (src/lib/data-stamp.ts).
export async function readStoredPrimer(
  userId: string,
  { client }: Pick<Options, "client">,
): Promise<{ primer: Primer; at: Date; builtAt: Date; stamp: string | null } | null> {
  try {
    const row = await client.janePreference.findUnique({
      where: { userId_kind_key: { userId, kind: "system", key: KEY } },
      select: { value: true },
    });
    const value = row?.value as {
      text?: unknown;
      cents?: unknown;
      at?: unknown;
      builtAt?: unknown;
      stamp?: unknown;
    } | null;
    if (
      !value ||
      typeof value.text !== "string" ||
      !Array.isArray(value.cents) ||
      typeof value.at !== "string"
    ) {
      return null;
    }
    return {
      primer: { text: value.text, cents: value.cents as number[] },
      at: new Date(value.at),
      // When it was worked out: at is set back to 0 to mark it old (markPrimerStale).
      builtAt: new Date(typeof value.builtAt === "string" ? value.builtAt : value.at),
      stamp: typeof value.stamp === "string" ? value.stamp : null,
    };
  } catch {
    // No database to read (a test's stand-in) or a bad row: the numbers are worked out instead.
    return null;
  }
}

export async function writeStoredPrimer(
  userId: string,
  primer: Primer,
  { client, now, stamp = null }: Options & { stamp?: string | null },
): Promise<void> {
  const value = { text: primer.text, cents: primer.cents, at: now.toISOString(), stamp };
  try {
    await client.janePreference.upsert({
      where: { userId_kind_key: { userId, kind: "system", key: KEY } },
      create: { userId, kind: "system", key: KEY, value, label: "Numbers for Claude" },
      update: { value },
    });
  } catch (error) {
    console.error("Saving the person's numbers for Claude failed", { error: String(error) });
  }
}

export const isStale = (at: Date, now: Date) =>
  now.getTime() - at.getTime() >= CHAT_PRIMER_STORED_MINUTES * 60_000 ||
  now.getTime() < at.getTime();

// Whether saved numbers may be said at all (card-chat mismatch): only ones worked out today, from
// the data as it is now. Otherwise the chat would repeat a disconnected bank's purchase or
// yesterday's "in 3 days". Old within the day (or after a tap) is still fine: it is used at once
// and refreshed behind (isStale).
export const usablePrimer = (
  stored: { builtAt: Date; stamp: string | null },
  stamp: string | null,
  now: Date,
) => isoDay(stored.builtAt) === isoDay(now) && sameData(stored.stamp, stamp);

// Something changed (a tap, a correction): the saved numbers are old; the next question
// refreshes them. Cheap, and it never fails the change.
export async function markPrimerStale(
  userId: string,
  { client, now = new Date() }: Pick<Options, "client"> & { now?: Date },
): Promise<void> {
  // The snapshot behind the agenda and the tools is just as old: marked, and rebuilt now in the
  // background so it is ready by the next question. It is built as of the caller's time: a
  // rebuild on the real clock would settle what is due by then (a rollover) ahead of the caller.
  await staleAndRefreshSnapshot(userId, { client, now });
  try {
    const row = await client.janePreference.findUnique({
      where: { userId_kind_key: { userId, kind: "system", key: KEY } },
      select: { value: true },
    });
    if (!row) return;
    const value = row.value as { at?: string; builtAt?: string };
    await client.janePreference.update({
      where: { userId_kind_key: { userId, kind: "system", key: KEY } },
      data: {
        value: { ...value, at: new Date(0).toISOString(), builtAt: value.builtAt ?? value.at },
      },
    });
  } catch {
    // Nothing saved yet, or no database: nothing to mark.
  }
}
