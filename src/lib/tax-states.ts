import { STATE_AGENCY_CATEGORIES, usesFoundAnswers } from "@/config/tax";
import { isStateCode } from "@/config/referrals";
import { LOCAL_TAXES } from "@/config/tax-states";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { autopilotFor } from "@/lib/sector-autopilot";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { saveTaxAnswers } from "@/lib/tax-profile";
import { localitiesIn, spotMove, type Move, type Residency } from "@/planning/tax-states";

// Where the person lived and worked in a tax year (spec step 165): moves, an out-of-state
// employer and a city or county income tax. Loaded from what they told Jane, and a move
// Jane spotted in their payments to state agencies; saved from the chat and the profile.

type Options = { client?: PrismaClient; now?: Date };

export class ResidencyError extends Error {}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type ResidencyView = {
  year: number;
  // What the person told Jane for this year (moves), or null when they haven't.
  told: Move[] | null;
  // A move Jane spotted, when the person hasn't said.
  spotted: Move | null;
  // What the estimate uses: told; else, at the levels that let Jane act, what it spotted.
  inUse: Move[];
  usingSpotted: boolean;
  workState: string | null;
  // A LOCAL_TAXES key, "none" (the person said neither), or null (not asked yet).
  locality: string | null;
  // A move started on the life-events checklist this year.
  movingEvent: string | null;
};

export function parseMoves(value: unknown): Move[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m): m is Move =>
      typeof m === "object" &&
      m !== null &&
      typeof (m as Move).date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test((m as Move).date) &&
      isStateCode((m as Move).from) &&
      isStateCode((m as Move).to),
  );
}

export async function loadResidency(
  userId: string,
  year: number,
  { client = defaultClient }: Options = {},
): Promise<ResidencyView> {
  const db = scopedFor(userId, client);
  const [stored, payments, moving, taxes] = await Promise.all([
    db.taxProfiles.findFirst({
      select: { moves: true, workState: true, locality: true, residencyYear: true },
    }),
    db.transactions.findMany({
      where: {
        pending: false,
        amountCents: { gt: 0 },
        pfcDetailed: { in: [...STATE_AGENCY_CATEGORIES] },
        date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      select: { date: true, description: true },
    }),
    db.lifeEvents.findFirst({
      where: {
        kind: "moving",
        startedOn: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      select: { startedOn: true },
      orderBy: { startedOn: "desc" },
    }),
    autopilotFor(userId, "taxes", { client }),
  ]);
  const told = stored?.residencyYear === year ? parseMoves(stored.moves) : null;
  const spotted = told
    ? null
    : spotMove(
        year,
        payments.map((p) => ({ date: iso(p.date), description: p.description })),
        isStateCode,
      );
  const usingSpotted = !told && spotted !== null && usesFoundAnswers(taxes.level);
  return {
    year,
    told,
    spotted,
    inUse: told ?? (usingSpotted && spotted ? [spotted] : []),
    usingSpotted,
    workState: stored?.workState ?? null,
    locality: stored?.locality ?? null,
    movingEvent: moving ? iso(moving.startedOn) : null,
  };
}

// For the estimate: the residency with the paydays to split wages by.
export function residencyFor(
  view: ResidencyView,
  paydays: { date: string; cents: number }[],
): Residency | undefined {
  const locality = view.locality && view.locality !== "none" ? view.locality : null;
  if (view.inUse.length === 0 && !view.workState && !locality) return undefined;
  return { moves: view.inUse, workState: view.workState, locality, paydays };
}

async function save(
  userId: string,
  data: {
    moves?: Move[];
    residencyYear?: number;
    workState?: string | null;
    locality?: string | null;
  },
  fields: string,
  { client = defaultClient, via }: Options & { via: "chat" | "page" },
) {
  const db = scopedFor(userId, client);
  await db.taxProfiles.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  await logAudit(
    { type: "user", id: userId },
    "tax_profile_changed",
    { type: "user", id: userId },
    { fields, via },
  );
  await track(userId, "tax_profile_answered", { fields, via });
}

// The moves in a year (none: one state all year). The state at the year's end becomes the
// profile's state.
export async function saveMoves(
  userId: string,
  year: number,
  moves: Move[],
  options: Options & { via: "chat" | "page" },
): Promise<void> {
  const today = iso(options.now ?? new Date());
  for (const m of moves) {
    if (!isStateCode(m.from) || !isStateCode(m.to)) {
      throw new ResidencyError("Pick both states from the list.");
    }
    if (m.from === m.to) throw new ResidencyError("Pick two different states.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date) || Number.isNaN(Date.parse(m.date))) {
      throw new ResidencyError("Give the date you moved.");
    }
    if (!m.date.startsWith(String(year))) {
      throw new ResidencyError(`Give a date in ${year}.`);
    }
    if (m.date > today) throw new ResidencyError("The move date can't be in the future.");
  }
  const sorted = [...moves].sort((a, b) => a.date.localeCompare(b.date));
  await save(userId, { moves: sorted, residencyYear: year }, "moves", options);
  const last = sorted.at(-1);
  if (last) {
    await saveTaxAnswers(userId, [{ field: "state", value: last.to }], options);
  }
}

export async function saveWorkState(
  userId: string,
  workState: string | null,
  options: Options & { via: "chat" | "page" },
): Promise<void> {
  if (workState !== null && !isStateCode(workState)) {
    throw new ResidencyError("Pick a state from the list.");
  }
  await save(userId, { workState }, "workState", options);
}

// A LOCAL_TAXES key in the person's state, or "none".
export async function saveLocality(
  userId: string,
  locality: string,
  options: Options & { via: "chat" | "page"; state: string | null },
): Promise<void> {
  if (locality !== "none") {
    const local = LOCAL_TAXES[locality];
    if (!local) throw new ResidencyError("Pick a city from the list.");
    if (!localitiesIn(options.state).some((l) => l.key === locality)) {
      throw new ResidencyError(`${local.label} isn't in your state on your tax profile.`);
    }
  }
  await save(userId, { locality }, "locality", options);
}
