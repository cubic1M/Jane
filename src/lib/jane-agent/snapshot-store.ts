import { CHAT_SNAPSHOT_STORED_MINUTES } from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Snapshot } from "./snapshot";
import { isoDay as day } from "@/lib/dates";

// Jane's snapshot of a person (everything the agenda, the whole-picture and priorities answers
// and the chat's tools read), kept in the database (depth first): building it looks up every
// sector, 10 to 30 seconds on a slow database, so it is built after each sync, scan and
// correction and saved as one row; the chat reads that row in one query and refreshes it in the
// background once it is stale. One jane_preferences row (kind "system"), which Settings does
// not list. The brain's own runs always build a fresh one (./snapshot.ts loadSnapshot).

type Options = { client: PrismaClient; now: Date };
const KEY = "snapshot";

// Dates come back from JSON as text; the fields that are dates (createdAt, completedAt and the
// like) are turned back into dates.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
export function reviveDates(key: string, value: unknown): unknown {
  return typeof value === "string" && /At$/.test(key) && ISO.test(value) ? new Date(value) : value;
}

type Stored = { at: string; snapshot: Snapshot | null };

async function read(
  userId: string,
  client: PrismaClient,
): Promise<{ at: Date; snapshot: Snapshot | null } | null> {
  try {
    const row = await client.janePreference.findUnique({
      where: { userId_kind_key: { userId, kind: "system", key: KEY } },
      select: { value: true },
    });
    if (!row) return null;
    // The reviver needs the text form: one round trip through JSON.
    const parsed = JSON.parse(JSON.stringify(row.value), reviveDates) as Stored;
    if (typeof parsed.at !== "string") return null;
    return { at: new Date(parsed.at), snapshot: parsed.snapshot ?? null };
  } catch {
    // No database to read (a test's stand-in) or a bad row: it is built instead.
    return null;
  }
}

async function write(userId: string, snapshot: Snapshot | null, { client, now }: Options) {
  const value = JSON.parse(JSON.stringify({ at: now.toISOString(), snapshot })) as object;
  try {
    await client.janePreference.upsert({
      where: { userId_kind_key: { userId, kind: "system", key: KEY } },
      create: { userId, kind: "system", key: KEY, value, label: "Snapshot" },
      update: { value },
    });
  } catch (error) {
    console.error("Saving the person's snapshot failed", { error: String(error) });
  }
}

// Saves a snapshot that was just built for another purpose (the brain's run builds one after
// every sync): the first chat question then finds it saved instead of building it, which is
// what made a new person's first question slow.
export async function saveSnapshot(
  userId: string,
  snapshot: Snapshot | null,
  options: Options,
): Promise<void> {
  await write(userId, snapshot, options);
}

// Builds a fresh snapshot and saves it. After a sync, a scan or a correction.
export async function refreshSnapshot(userId: string, options: Options): Promise<Snapshot | null> {
  const { loadSnapshot } = await import("./snapshot");
  const snapshot = await loadSnapshot(userId, options);
  await write(userId, snapshot, options);
  return snapshot;
}

const refreshing = new Set<string>();

// The saved snapshot, in one query. A copy from today that is old is still returned at once and
// refreshed behind; with none saved, or one from another day, it is built here, once.
export async function loadSnapshotFast(userId: string, options: Options): Promise<Snapshot | null> {
  const { client, now } = options;
  const stored = await read(userId, client);
  if (stored && day(stored.at) === day(now)) {
    const old = now.getTime() - stored.at.getTime() >= CHAT_SNAPSHOT_STORED_MINUTES * 60_000;
    if ((old || now.getTime() < stored.at.getTime()) && !refreshing.has(userId)) {
      refreshing.add(userId);
      void refreshSnapshot(userId, options)
        .catch((error) => console.error("Refreshing the snapshot failed", { error: String(error) }))
        .finally(() => refreshing.delete(userId));
    }
    return stored.snapshot;
  }
  return refreshSnapshot(userId, options);
}

// Something changed (a tap, a correction): the saved snapshot is old, so the next question
// refreshes it behind its answer. Cheap, and never fails the change.
export async function markSnapshotStale(
  userId: string,
  { client }: Pick<Options, "client">,
): Promise<void> {
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
    // Nothing saved yet, or no database.
  }
}

// Marks it old and starts rebuilding it, without waiting: a tap or a correction has just changed
// what is open, and the next question should see that.
export async function staleAndRefreshSnapshot(userId: string, options: Options): Promise<void> {
  await markSnapshotStale(userId, options);
  // Always a new build, even if one is running: that one began before this change.
  void refreshSnapshot(userId, options).catch((error) =>
    console.error("Refreshing the snapshot failed", { error: String(error) }),
  );
}
