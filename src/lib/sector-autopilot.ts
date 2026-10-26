import { cache } from "react";
import {
  MAX_SECTOR_CAP_CENTS,
  SECTORS,
  SECTOR_DEFAULTS,
  SECTOR_LEVELS,
  type Sector,
  type SectorLevel,
  type SectorSetting,
} from "@/config/autopilot-sectors";
import type { AutopilotChoice } from "@/config/autopilot";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// The person's step 57 level. Read here rather than through src/lib/autopilot.ts, which
// applies the standing rules, which read this module.
async function globalLevel(userId: string, client: PrismaClient): Promise<string | null> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { autopilot: true } });
  return user?.autopilot ?? null;
}

// One autopilot, every sector (spec step 141). Every sector's automation asks mayAct before
// it does anything by itself, and records what it did with recordAct, so no sector acts
// above its level or cap. What a person sets here takes effect at once and is audited.

type Options = { client?: PrismaClient; now?: Date };

export type SectorAutopilot = SectorSetting & {
  sector: Sector;
  // "set" when the person chose it for this sector, else the default for their level.
  source: "default" | "set";
  // What this sector already moved or committed by itself this calendar month (UTC).
  usedThisMonthCents: number;
};

const RANK: Record<SectorLevel, number> = { ask: 0, safe: 1, all: 2 };

const isSector = (v: unknown): v is Sector =>
  typeof v === "string" && (SECTORS as readonly string[]).includes(v);
const isLevel = (v: unknown): v is SectorLevel =>
  typeof v === "string" && (SECTOR_LEVELS as readonly string[]).includes(v);

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// The step 57 level the defaults come from: custom rules count as "Handle the safe stuff",
// and no choice yet as "Ask me first".
function baseLevel(global: string | null): AutopilotChoice {
  if (global === "all" || global === "safe") return global;
  return global === "custom" ? "safe" : "ask";
}

export async function sectorAutopilots(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<SectorAutopilot[]> {
  return client === defaultClient
    ? sectorAutopilotsOnce(userId, monthStart(now).toISOString())
    : sectorAutopilotsFrom(userId, client, monthStart(now));
}

// Read once per server render (React's cache): every area's "what Jane does on its own" asks.
const sectorAutopilotsOnce = cache((userId: string, month: string) =>
  sectorAutopilotsFrom(userId, defaultClient, new Date(month)),
);

async function sectorAutopilotsFrom(
  userId: string,
  client: PrismaClient,
  since: Date,
): Promise<SectorAutopilot[]> {
  const db = scopedFor(userId, client);
  const [global, rows, used] = await Promise.all([
    globalLevel(userId, client),
    db.autopilotSectors.findMany({
      select: { sector: true, level: true, actionCapCents: true, monthlyCapCents: true },
    }),
    db.autopilotActs.groupBy({
      by: ["sector"],
      where: { createdAt: { gte: since } },
      _sum: { cents: true },
    }),
  ]);
  const base = baseLevel(global);
  return SECTORS.map((sector) => {
    const row = rows.find((r) => r.sector === sector);
    // "Ask me first" asks everywhere, whatever a sector says.
    const set: SectorSetting | null =
      row && isLevel(row.level) && base !== "ask"
        ? {
            level: row.level,
            actionCapCents: row.actionCapCents,
            monthlyCapCents: row.monthlyCapCents,
          }
        : null;
    return {
      sector,
      ...(set ?? SECTOR_DEFAULTS[base][sector]),
      source: set ? "set" : "default",
      usedThisMonthCents: used.find((u) => u.sector === sector)?._sum.cents ?? 0,
    };
  });
}

export async function autopilotFor(
  userId: string,
  sector: Sector,
  options: Options = {},
): Promise<SectorAutopilot> {
  return (await sectorAutopilots(userId, options)).find((s) => s.sector === sector)!;
}

export type MayAct =
  | { ok: true; setting: SectorAutopilot }
  | { ok: false; reason: "level" | "action_cap" | "monthly_cap"; setting: SectorAutopilot };

// Whether a sector may do something by itself: its level allows what the action needs, and
// the money it moves or commits fits both caps. Free actions (cents 0) need the level only.
export async function mayAct(
  userId: string,
  sector: Sector,
  { needs, cents }: { needs: "safe" | "all"; cents: number },
  options: Options = {},
): Promise<MayAct> {
  const setting = await autopilotFor(userId, sector, options);
  if (RANK[setting.level] < RANK[needs]) return { ok: false, reason: "level", setting };
  const amount = Math.max(0, Math.round(cents));
  if (amount > 0 && amount > setting.actionCapCents) {
    return { ok: false, reason: "action_cap", setting };
  }
  if (amount > 0 && setting.usedThisMonthCents + amount > setting.monthlyCapCents) {
    return { ok: false, reason: "monthly_cap", setting };
  }
  return { ok: true, setting };
}

// Records what a sector did by itself, for the monthly cap and the log.
export async function recordAct(
  userId: string,
  sector: Sector,
  cents: number,
  what: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  await scopedFor(userId, client).autopilotActs.create({
    data: {
      userId,
      sector,
      cents: Math.max(0, Math.round(cents)),
      what: what.slice(0, 200),
      createdAt: now,
    },
  });
}

export class SectorAutopilotError extends Error {}

export type SectorChange = {
  level?: SectorLevel;
  actionCapCents?: number;
  monthlyCapCents?: number;
};

// The person's choice for one sector, from Settings or the chat. A cap left out keeps what
// the sector has now. Audited, and in effect at once.
export async function setSectorAutopilot(
  userId: string,
  sector: unknown,
  change: SectorChange,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<SectorAutopilot> {
  if (!isSector(sector)) throw new SectorAutopilotError("Pick one of the areas.");
  if (change.level !== undefined && !isLevel(change.level)) {
    throw new SectorAutopilotError("Pick how much Jane may do.");
  }
  for (const cap of [change.actionCapCents, change.monthlyCapCents]) {
    if (cap !== undefined && (!Number.isInteger(cap) || cap < 0 || cap > MAX_SECTOR_CAP_CENTS)) {
      throw new SectorAutopilotError("Enter a dollar amount up to $100,000.");
    }
  }
  if ((await globalLevel(userId, client)) === "ask") {
    throw new SectorAutopilotError(
      "You've asked Jane to ask first about everything. Pick a level for it in Settings first.",
    );
  }
  const current = await autopilotFor(userId, sector, { client, now });
  // Only a monthly cap ("up to $50 a month") for an area with no per-time cap: one action
  // may use all of it.
  const action =
    change.actionCapCents ??
    (change.monthlyCapCents !== undefined && current.actionCapCents === 0
      ? change.monthlyCapCents
      : current.actionCapCents);
  const next: SectorSetting = {
    level: change.level ?? current.level,
    actionCapCents: action,
    monthlyCapCents: change.monthlyCapCents ?? current.monthlyCapCents,
  };
  if (next.actionCapCents > next.monthlyCapCents) next.monthlyCapCents = next.actionCapCents;
  await scopedFor(userId, client).autopilotSectors.upsert({
    where: { userId_sector: { userId, sector } },
    create: { userId, sector, ...next },
    update: next,
  });
  await logAudit(
    { type: "user", id: userId },
    "autopilot_sector_set",
    { type: "user", id: userId },
    { sector, ...next },
  );
  await track(userId, "autopilot_sector_set", { sector, level: next.level });
  return autopilotFor(userId, sector, { client, now });
}

// Back to the default for the person's level.
export async function resetSectorAutopilot(
  userId: string,
  sector: Sector,
  { client = defaultClient }: Options = {},
): Promise<void> {
  await scopedFor(userId, client).autopilotSectors.deleteMany({ where: { sector } });
  await logAudit(
    { type: "user", id: userId },
    "autopilot_sector_set",
    { type: "user", id: userId },
    { sector, reset: true },
  );
}
