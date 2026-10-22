import { CHAT_PRIMER_STORED_MINUTES } from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { staleAndRefreshSnapshot } from "./snapshot-store";

// The person's numbers for Claude, kept in the database (spec step 93, depth first): computing
// them looks every sector up (20 seconds or more on a slow database), so it is done after each
// sync, scan and correction and saved as one row; the chat reads that row in one query and
// refreshes it in the background once it is stale. One jane_preferences row (kind "system"),
// which Settings does not list.

type Primer = { text: string; cents: number[] };
type Options = { client: PrismaClient; now: Date };

const KEY = "primer";

export async function readStoredPrimer(
  userId: string,
  { client }: Pick<Options, "client">,
): Promise<{ primer: Primer; at: Date } | null> {
  try {
    const row = await client.janePreference.findUnique({
      where: { userId_kind_key: { userId, kind: "system", key: KEY } },
      select: { value: true },
    });
    const value = row?.value as { text?: unknown; cents?: unknown; at?: unknown } | null;
    if (
      !value ||
      typeof value.text !== "string" ||
      !Array.isArray(value.cents) ||
      typeof value.at !== "string"
    ) {
      return null;
    }
    return { primer: { text: value.text, cents: value.cents as number[] }, at: new Date(value.at) };
  } catch {
    // No database to read (a test's stand-in) or a bad row: the numbers are worked out instead.
    return null;
  }
}

export async function writeStoredPrimer(
  userId: string,
  primer: Primer,
  { client, now }: Options,
): Promise<void> {
  const value = { text: primer.text, cents: primer.cents, at: now.toISOString() };
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
    await client.janePreference.update({
      where: { userId_kind_key: { userId, kind: "system", key: KEY } },
      data: { value: { ...(row.value as object), at: new Date(0).toISOString() } },
    });
  } catch {
    // Nothing saved yet, or no database: nothing to mark.
  }
}
