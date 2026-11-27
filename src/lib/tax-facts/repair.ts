import {
  LEGACY_DONE_KEY,
  NOT_YEAR_SCOPED,
  isTaxFactKey,
  taxFactSpec,
  type TaxFactKey,
} from "@/config/tax-facts";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { personTransaction } from "@/lib/db-scoped";
import { ensureChildIds } from "@/lib/tax-facts/child-ids";
import {
  OLD_STORE_KEYS,
  OLD_STORE_MEMBER_KEYS,
  isProfileMember,
  legacyRows,
  type LegacySources,
} from "@/lib/tax-facts/legacy";
import { OWN_WORD_ORIGINS, storedFactData, writeFactRow } from "@/lib/tax-facts/write";

// Read-repair (tax roadmap 1.3, step T9): the household record brought in line with the older
// stores, which stay the source of truth for now. It is a sync, so it can run again at any time and
// leaves the record the same: a row that differs is superseded, a row the stores no longer say is
// removed, and the marker household.legacy_done goes in last, in the same transaction, so a year is
// either copied whole or not at all. A writer that could not update the record clears the marker
// (markNeedsRepair), and the next read of the household copies again.

type Options = { client?: PrismaClient; now?: Date };

// The sensitive facts a repair would write that the record does not hold yet, by key and origin
// (never a value): audited before the write, as every sensitive write is.
export function sensitiveChanges(
  copy: ReturnType<typeof legacyRows>,
  stored: readonly { key: string; origin: string; value: unknown }[],
  userId: string,
  day: string,
): { key: TaxFactKey; origin: string }[] {
  const seen = new Set<string>();
  const out: { key: TaxFactKey; origin: string }[] = [];
  for (const input of copy.facts) {
    if (!isTaxFactKey(input.key) || !taxFactSpec(input.key).sensitive) continue;
    let data;
    try {
      data = storedFactData(userId, input, day);
    } catch {
      continue;
    }
    const same = stored.some(
      (s) =>
        s.key === data.key &&
        s.origin === data.origin &&
        JSON.stringify(s.value) === JSON.stringify(data.value),
    );
    const mark = `${input.key}|${input.origin}`;
    if (!same && !seen.has(mark)) {
      seen.add(mark);
      out.push({ key: input.key, origin: input.origin });
    }
  }
  return out;
}

export async function repairRecord(
  userId: string,
  taxYear: number,
  sources: LegacySources,
  stored: readonly { key: string; origin: string; value: unknown }[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  // Written to the audit log first: an entry for a copy that then fails is a harmless extra, a copy
  // with no entry is not.
  for (const { key, origin } of sensitiveChanges(
    legacyRows(sources),
    stored,
    userId,
    sources.today,
  ))
    await logAudit(
      { type: "user", id: userId },
      "tax_fact_recorded",
      { type: "user", id: userId },
      { key, origin },
    );
  await personTransaction(
    userId,
    async (tx) => {
      // Each child on the family form gets an id the first time (written back to the form's JSON
      // here), so the member keys below never depend on a child's place in the list.
      const withIds = await ensureChildIds(tx, userId);
      const read: LegacySources = {
        ...sources,
        profile:
          sources.profile && withIds !== null
            ? { ...sources.profile, familyChildren: withIds }
            : sources.profile,
      };
      const copy = legacyRows(read);
      const marker = {
        key: LEGACY_DONE_KEY,
        value: true,
        taxYear,
        origin: "legacy",
        sourceRef: "read-repair",
        asOf: sources.today,
      } as const;
      // A year that was copied before and is being copied again is brought in line with the stores
      // (what they no longer say goes). The first copy only adds: a fact the record holds that no
      // store ever had stays.
      const copiedBefore =
        (await tx.taxFact.count({
          where: { userId, taxYear, key: LEGACY_DONE_KEY, supersededAt: null },
        })) > 0;
      const wanted = new Set<string>();
      for (const input of [...copy.facts, marker]) {
        let data;
        try {
          data = storedFactData(userId, input, sources.today);
        } catch {
          continue; // a value outside the fact's kind is left out, not a failed read
        }
        wanted.add(`${data.taxYear}|${data.memberKey}|${data.key}|${data.origin}`);
        await writeFactRow(tx, userId, data, now);
      }

      // What the stores no longer say goes (the person took it back, or the write that would have
      // said so did not land).
      const held = await tx.taxFact.findMany({
        where: {
          userId,
          taxYear: { in: [taxYear, NOT_YEAR_SCOPED] },
          origin: { in: [...OWN_WORD_ORIGINS] },
          OR: [
            { key: { in: [...OLD_STORE_KEYS] }, memberKey: "self" },
            { key: { in: [...OLD_STORE_MEMBER_KEYS] } },
          ],
        },
        select: { id: true, taxYear: true, memberKey: true, key: true, origin: true },
      });
      const drop = held
        .filter(
          (r) =>
            (r.memberKey === "self" || isProfileMember(r.memberKey)) &&
            !wanted.has(`${r.taxYear}|${r.memberKey}|${r.key}|${r.origin}`),
        )
        .map((r) => r.id);
      if (copiedBefore && drop.length > 0)
        await tx.taxFact.deleteMany({ where: { userId, id: { in: drop } } });

      // The members: those the stores give are present (added, or brought back); the ones the
      // profile made that it no longer gives are marked removed, never renumbered, and what was
      // said about them goes.
      const keep = copy.members.map((m) => m.memberKey);
      await tx.taxHouseholdMember.createMany({
        data: copy.members.map((m) => ({ ...m, userId, taxYear })),
        skipDuplicates: true,
      });
      await tx.taxHouseholdMember.updateMany({
        where: { userId, taxYear, memberKey: { in: keep }, removedAt: { not: null } },
        data: { removedAt: null },
      });
      const alive = await tx.taxHouseholdMember.findMany({
        where: { userId, taxYear, removedAt: null, memberKey: { notIn: keep } },
        select: { memberKey: true },
      });
      const gone = alive.map((m) => m.memberKey).filter(isProfileMember);
      if (copiedBefore && gone.length > 0) {
        await tx.taxHouseholdMember.updateMany({
          where: { userId, taxYear, memberKey: { in: gone } },
          data: { removedAt: now },
        });
        await tx.taxFact.deleteMany({
          where: {
            userId,
            memberKey: { in: gone },
            origin: { in: [...OWN_WORD_ORIGINS] },
          },
        });
      }
    },
    client,
  );
}

// A writer could not update the record after the older store had the answer: the marker of every
// year is set to "not copied" (it stays, so the next copy knows it is a second one), and the next
// read of the household copies the stores again. Safe to call twice.
export async function markNeedsRepair(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  await personTransaction(
    userId,
    (tx) =>
      tx.taxFact.updateMany({
        where: { userId, key: LEGACY_DONE_KEY, supersededAt: null },
        data: { value: { v: false } },
      }),
    client,
  );
}
