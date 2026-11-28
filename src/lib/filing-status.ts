import { isFilingStatus, type FilingStatus } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { markPrimerStale } from "@/lib/jane-agent/primer-store";
import { savePreference } from "@/lib/jane-agent/preferences";
import { systemDb } from "@/lib/system-db";
import { listFacts, toldFromFacts } from "@/lib/memory/facts";
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

// Whether the person has told Jane they have a partner: true (a partner, or a household of a
// couple), false (a household of one), null (not said). The same reading the profile's facts make
// (a correction on the card wins over what memory holds), for the callers with no profile built,
// so the estimate and the cards guess a person's filing status from the same word (T8b).
export async function loadToldPartner(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<boolean | null> {
  const db = scopedFor(userId, client);
  const [prefs, known] = await Promise.all([
    db.janePreferences.findMany({
      where: { kind: "fact", key: { in: ["profile:has_partner", "profile:household"] } },
      select: { key: true, value: true },
    }),
    listFacts(userId, { client }),
  ]);
  const told = toldFromFacts(known);
  for (const p of prefs) {
    const value = valueOf(p.value);
    if (p.key === "profile:has_partner" && typeof value === "boolean") told.has_partner = value;
    if (p.key === "profile:household" && typeof value === "string") told.household = value;
  }
  if (typeof told.has_partner === "boolean") return told.has_partner;
  if (told.household === "couple") return true;
  if (told.household === "single") return false;
  return null;
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

// A write to `answered` is made against the list that was read, and tried again when another save
// changed it in between (two saves at once must not drop each other's marker).
const WRITE_TRIES = 4;

// The told answer, written to the tax profile's row and marked answered, like the children mirror.
// With `whileTold` (the writer that just saved the told answer) the copy is written only while that
// told answer is still there: its preference row is locked first, so a Forget that runs between the
// two saves either finishes before (nothing is written) or waits for this write and then takes it
// back. A forgotten answer is never put back; a new answer saved afterwards writes its own copy.
export async function mirrorFilingToProfile(
  userId: string,
  status: FilingStatus,
  { client = defaultClient, whileTold = false }: Options & { whileTold?: boolean } = {},
): Promise<void> {
  await scopedFor(userId, client).transaction(async (tx) => {
    if (whileTold) {
      const pref = await tx.janePreferences.findFirst({
        where: { kind: "fact", key: TOLD_FILING_KEY },
        select: { label: true, value: true },
      });
      if (!pref || valueOf(pref.value) !== status) return;
      // A write that changes nothing, to take the row's lock: Forget's delete waits for it.
      const held = await tx.janePreferences.updateMany({
        where: { kind: "fact", key: TOLD_FILING_KEY, label: pref.label },
        data: { label: pref.label },
      });
      if (held.count === 0) return;
    }
    for (let attempt = 0; attempt < WRITE_TRIES; attempt += 1) {
      const existing = await tx.taxProfiles.findFirst({ select: { answered: true } });
      if (!existing) {
        const made = await tx.taxProfiles.createMany({
          data: [{ userId, filingStatus: status, answered: ["filingStatus"] }],
          skipDuplicates: true,
        });
        if (made.count > 0) return;
        continue;
      }
      const answered = [...new Set([...existing.answered, "filingStatus"])];
      const saved = await tx.taxProfiles.updateMany({
        where: { answered: { equals: existing.answered } },
        data: { filingStatus: status, answered },
      });
      if (saved.count > 0) return;
    }
    throw new Error("The tax profile kept changing while the filing status was saved");
  });
}

// The reverse of the mirror, taken back with the told answer, is src/lib/told-mirrors.ts: every way a
// person forgets it (Settings, a deleted preference, a cleared correction) goes through it.
