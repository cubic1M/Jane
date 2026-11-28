import { OPEN_RUN_STALE_MINUTES } from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { dataStamp, sameData } from "@/lib/data-stamp";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { withPersonLock } from "@/lib/person-lock";
import { timezoneOf } from "@/lib/today";
import { postedToday } from "./messages";
import { localTime } from "./quiet-hours";
import { chatting, runJaneAgent } from "./run";

// Jane's own turn when the chat opens (spec steps 81, 92): the person looks at the chat with nothing
// posted yet today, or has talked since. The chat opens at once on what is stored and says a turn
// is owed (`runState`, read only); the browser then says the chat is really on screen
// (/api/opened, src/lib/page-opened.ts: a page's render also runs when it is loaded ahead of time,
// so it cannot start work), and `startOpenTurn` runs the turn after that response. What it posts
// reaches the open page through the pulse (src/app/chat/scan-refresher.tsx). So that opens do not
// each start one:
//   - one run per person at a time: a marker says "running" (believed for OPEN_RUN_STALE_MINUTES),
//     claimed under the person's lock;
//   - a run that has finished is remembered for the person's day, the data it saw and what they
//     had typed, and not repeated until one of those changes (a run that had nothing to post
//     used to run again on every open).
// The marker is a small stored fact, not a table of its own.

const KEY = "open_run";

type Marker = {
  day: string;
  at: string;
  state: "running" | "done";
  posted: number;
  stamp: string | null;
  typedAt: string | null;
  // Who claimed it: a run that outlived its lease cannot close the marker of the run after it.
  token?: string;
};

const asMarker = (value: unknown): Marker | null => {
  const v = value as Partial<Marker> | null;
  return v && typeof v.day === "string" && typeof v.at === "string" && typeof v.state === "string"
    ? (v as Marker)
    : null;
};

// What the page shows: a turn is "owed" (running or about to be), or the day is "settled".
export type OpenRun = "owed" | "settled";

type Options = { client: PrismaClient; now: Date };
type Seen = { timezone: string | null; typedAt: Date | null };

// Spec step 92: whether the person typed since Jane last posted on its own, and when they last typed.
async function talkedSince(userId: string, client: PrismaClient) {
  const db = scopedFor(userId, client);
  const [typed, posted] = await Promise.all([
    db.janeMessages.findFirst({
      where: { kind: "user" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    db.janeMessages.findFirst({
      where: { kind: { in: ["brief", "decision", "done", "heads_up"] } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return {
    talked: typed !== null && (posted === null || typed.createdAt > posted.createdAt),
    typedAt: typed?.createdAt ?? null,
  };
}

// Whether Jane has said nothing today, or the person has talked since (the turn is owed), and
// when they last typed.
export async function turnOwed(userId: string, { client, now }: Options, timezone: string | null) {
  const [today, talk] = await Promise.all([
    postedToday(userId, timezone, { client, now }),
    talkedSince(userId, client),
  ]);
  return { owed: !today || talk.talked, typedAt: talk.typedAt };
}

// The marker against today: "running" while a turn is out, true when the day's turn is done for
// this data and conversation, false when one is still to start.
function settledBy(
  marker: Marker | null,
  day: string,
  stamp: string | null,
  seen: Seen,
  now: Date,
): boolean | "running" {
  if (marker?.state === "running")
    return now.getTime() - new Date(marker.at).getTime() < OPEN_RUN_STALE_MINUTES * 60_000
      ? "running"
      : false;
  return (
    marker?.state === "done" &&
    marker.day === day &&
    sameData(marker.stamp, stamp) &&
    // Typing after the run is the only thing left that changes it.
    (marker.typedAt ?? null) === (seen.typedAt?.toISOString() ?? null)
  );
}

const where = (userId: string) => ({ userId_kind_key: { userId, kind: "system", key: KEY } });

// For the page: read only. A turn is owed (or out) unless the day's turn is done, nothing is owed,
// or they are chatting (Jane's own messages wait, spec step 92).
export async function runState(
  userId: string,
  { client, now }: Options,
  seen: Seen & { owed: boolean },
): Promise<OpenRun> {
  if (await chatting(userId, { client, now })) return "settled";
  const [row, stamp] = await Promise.all([
    scopedFor(userId, client).janePreferences.findUnique({
      where: where(userId),
      select: { value: true },
    }),
    dataStamp(userId, client),
  ]);
  const day = localTime(now, seen.timezone).date;
  const settled = settledBy(asMarker(row?.value), day, stamp, seen, now);
  // A turn that is out keeps the page listening, even once what it posted has covered the day.
  if (settled === "running") return "owed";
  return seen.owed && settled !== true ? "owed" : "settled";
}

// The chat is on screen (/api/opened): starts Jane's turn if one is owed and none is out, and runs
// it. Never throws. A run that fails is remembered as done too, so every open does not try again.
export async function startOpenTurn(
  userId: string,
  { client = defaultClient, now = new Date() }: Partial<Options> = {},
): Promise<"started" | "not owed" | "running"> {
  try {
    const timezone = await timezoneOf(userId, { client });
    const { owed, typedAt } = await turnOwed(userId, { client, now }, timezone);
    if (!owed || (await chatting(userId, { client, now }))) return "not owed";
    let claimedToken = "";
    const claimed = await withPersonLock(
      "open-run",
      userId,
      async () => {
        const db = scopedFor(userId, client);
        const [row, stamp] = await Promise.all([
          db.janePreferences.findUnique({ where: where(userId), select: { value: true } }),
          dataStamp(userId, client),
        ]);
        const token = crypto.randomUUID();
        claimedToken = token;
        const day = localTime(now, timezone).date;
        const settled = settledBy(asMarker(row?.value), day, stamp, { timezone, typedAt }, now);
        if (settled) return settled === "running" ? ("running" as const) : ("not owed" as const);
        const value: Marker = {
          day,
          at: now.toISOString(),
          state: "running",
          posted: 0,
          stamp,
          typedAt: typedAt?.toISOString() ?? null,
          token,
        };
        await db.janePreferences.upsert({
          where: where(userId),
          create: { userId, kind: "system", key: KEY, value, label: "Jane's turn on open" },
          update: { value },
        });
        return "started" as const;
      },
      { client, wait: true },
    );
    if (!claimed.ran) return "running";
    if (claimed.value !== "started") return claimed.value;
    await runOpenTurn(userId, { client, now }, claimedToken);
    return "started";
  } catch (error) {
    log.error("Jane's turn on open failed", { userId, error: String(error) });
    return "not owed";
  }
}

// The turn itself: never throws, and leaves the marker "done", but only the marker of this claim
// (a run that outlived its lease finds another run's marker and leaves it alone).
async function runOpenTurn(userId: string, { client, now }: Options, token: string): Promise<void> {
  let posted = 0;
  try {
    posted = (await runJaneAgent(userId, { client, now, trigger: "open" })).posted;
  } catch (error) {
    log.error("Jane's chat run failed", { userId, error: String(error) });
  }
  try {
    const db = scopedFor(userId, client);
    const row = await db.janePreferences.findUnique({
      where: where(userId),
      select: { value: true },
    });
    const marker = asMarker(row?.value);
    if (marker && marker.token === token) {
      // Only while the stored token is still this run's, in the one statement.
      await db.janePreferences.updateMany({
        where: { userId, kind: "system", key: KEY, value: { path: ["token"], equals: token } },
        data: { value: { ...marker, state: "done", posted } },
      });
    }
  } catch (error) {
    log.error("Jane's turn marker was not saved", { userId, error: String(error) });
  }
}
