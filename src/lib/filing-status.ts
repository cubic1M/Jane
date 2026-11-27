import { isFilingStatus, type FilingStatus } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { markPrimerStale } from "@/lib/jane-agent/primer-store";
import { savePreference } from "@/lib/jane-agent/preferences";
import { systemDb } from "@/lib/system-db";
import { factWords } from "@/profile/facts";
import { filingStatusFor, type FilingRead, type StoredFiling } from "@/planning/tax-profile";

// One filing status (tax program T8). How the person files lives in two stores: the question card's
// told fact (jane_preferences "profile:filing_status", and the memory fact beside it) and the tax
// profile's own row. Writers keep them together (saveToldFiling, mirrorFilingToProfile); every
// reader goes through filingStatusFor (src/planning/tax-profile.ts), fed from here. A person whose
// stores already disagree is settled on the next read by the newer answer: no migration.

type Options = { client?: PrismaClient; now?: Date };

export const TOLD_FILING_KEY = "profile:filing_status";
const FORGOTTEN = "forgotten";

export type FilingLoad = {
  // What the person told Jane, from the card or the chat, and when (null when unknown).
  told: { value: FilingStatus; at: Date | null } | null;
  // The tax profile's row, and when its filing status was answered (null when unknown).
  stored: StoredFiling | null;
  // The two settled by the rule, with no guess (nothing found in the accounts is looked at here).
  read: FilingRead;
};

const valueOf = (json: unknown): unknown => (json as { value?: unknown } | null)?.value;
const atOf = (json: unknown): Date | null => {
  const raw = (json as { at?: unknown } | null)?.at;
  const at = typeof raw === "string" ? new Date(raw) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
};

const latest = (...dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

export async function loadFiling(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<FilingLoad> {
  const db = scopedFor(userId, client);
  const [pref, memory, row] = await Promise.all([
    db.janePreferences.findFirst({
      where: { kind: "fact", key: TOLD_FILING_KEY },
      select: { value: true, createdAt: true },
    }),
    db.userFacts.findFirst({
      where: { key: "filing_status", supersededById: null, source: { not: FORGOTTEN } },
      orderBy: [{ lastConfirmed: "desc" }, { id: "desc" }],
      select: { value: true, lastConfirmed: true },
    }),
    db.taxProfiles.findFirst({
      select: { filingStatus: true, answered: true },
    }),
  ]);
  // A correction made on the card wins over what memory holds, as everywhere else.
  const toldValue = isFilingStatus(valueOf(pref?.value))
    ? (valueOf(pref?.value) as FilingStatus)
    : isFilingStatus(valueOf(memory?.value))
      ? (valueOf(memory?.value) as FilingStatus)
      : null;
  const profileValue =
    row?.answered.includes("filingStatus") && isFilingStatus(row.filingStatus)
      ? row.filingStatus
      : null;

  // Times are read only when the two disagree: they are the only case that needs them.
  let toldAt: Date | null = null;
  let storedAt: Date | null = null;
  if (toldValue && profileValue && toldValue !== profileValue && row) {
    // The time written in the preference comes first. A preference saved before that has none: its
    // first save's time, and what memory last confirmed only when memory holds the same answer
    // (memory's time dates memory's own value). Told only in memory: when memory last confirmed it.
    const fromPref = isFilingStatus(valueOf(pref?.value));
    toldAt = fromPref
      ? (atOf(pref?.value) ??
        latest(
          valueOf(memory?.value) === toldValue ? memory?.lastConfirmed : null,
          pref?.createdAt,
        ))
      : (memory?.lastConfirmed ?? null);
    // The profile row's own updatedAt moves with every field (state, pay stub), so the day the
    // filing status was answered is read from the audit log: the last save that named it. A row
    // with no such entry has no time, and what the person told Jane wins.
    const audited = await systemDb(
      "Filing status: when the person last answered it on the tax profile",
      client,
    ).auditLog.findFirst({
      where: {
        event: "tax_profile_changed",
        targetId: userId,
        metadata: { path: ["fields"], string_contains: "filingStatus" },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    storedAt = audited?.createdAt ?? null;
  }
  const stored: StoredFiling | null = row
    ? { filingStatus: row.filingStatus, answered: row.answered, at: storedAt }
    : null;
  const told = toldValue ? { value: toldValue, at: toldAt } : null;
  return { told, stored, read: filingStatusFor({ filing_status: told ?? undefined }, stored) };
}

// The person's answer, as a told fact (what the question card saves), with the instant it was said.
export async function saveToldFiling(
  userId: string,
  status: FilingStatus,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  await savePreference(
    userId,
    {
      kind: "fact",
      key: TOLD_FILING_KEY,
      value: { value: status, at: now.toISOString() },
      label: `How you file taxes: ${factWords("filing_status", status)}`,
    },
    { client },
  );
  await markPrimerStale(userId, { client, now });
}

// The told answer, written to the tax profile's row and marked answered, like the children mirror.
export async function mirrorFilingToProfile(
  userId: string,
  status: FilingStatus,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const existing = await db.taxProfiles.findUnique({
    where: { userId },
    select: { answered: true },
  });
  const answered = [...new Set([...(existing?.answered ?? []), "filingStatus"])];
  await db.taxProfiles.upsert({
    where: { userId },
    create: { userId, filingStatus: status, answered },
    update: { filingStatus: status, answered },
  });
}

// The reverse of the mirror: the person took back what they told Jane, so the tax profile's copy
// of that same answer goes with it. A profile answer that says something else stays.
export async function unmirrorFilingFromProfile(
  userId: string,
  was: unknown,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  if (!isFilingStatus(was)) return;
  const row = await db.taxProfiles.findUnique({
    where: { userId },
    select: { filingStatus: true, answered: true },
  });
  if (!row || row.filingStatus !== was || !row.answered.includes("filingStatus")) return;
  // Only while the row still says what was read: an answer saved a moment ago stays.
  await db.taxProfiles.updateMany({
    where: { filingStatus: was },
    data: { filingStatus: null, answered: row.answered.filter((f) => f !== "filingStatus") },
  });
}
