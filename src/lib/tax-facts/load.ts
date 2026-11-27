import { LEGACY_DONE_KEY, NOT_YEAR_SCOPED } from "@/config/tax-facts";
import type { PrismaClient } from "@/generated/prisma/client";
import { isoDay } from "@/lib/dates";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { onlyDemoBank } from "@/lib/only-demo-bank";
import {
  OLD_STORE_KEYS,
  OLD_STORE_MEMBER_KEYS,
  foundRows,
  isProfileMember,
  legacyRows,
  readLegacySources,
} from "@/lib/tax-facts/legacy";
import { repairRecord } from "@/lib/tax-facts/repair";
import { loadTaxFacts } from "@/lib/tax-profile";
import { OWN_WORD_ORIGINS, storedFactData, type TaxFactInput } from "@/lib/tax-facts/write";
import { isTrialUser } from "@/lib/trial-ids";
import { todayOf } from "@/lib/today";
import {
  factId,
  mergeFacts,
  type Member,
  type StoredFact,
  type TaxHousehold,
} from "@/planning/tax-engine/facts";

// The household's tax facts for one tax year (tax roadmap 1.3, step T9): the stored rows, settled by
// the merge rule. The first time a person's year is read, their answers in the older stores are
// copied in (read-repair, src/lib/tax-facts/repair.ts), once, and the marker fact
// household.legacy_done says so. A sample person and a trial person are sample data and leave no
// trace, so theirs are worked out in memory on every read and never stored. Whatever Jane merely
// found in the accounts is added at read time, only where no stored fact speaks, and never stored.

type Options = { client?: PrismaClient; now?: Date };

const asStored = (input: TaxFactInput, day: string, now: Date): StoredFact => {
  const data = storedFactData("", input, day);
  return {
    key: data.key,
    memberKey: data.memberKey ?? "self",
    value: data.value,
    status: data.status,
    origin: data.origin,
    sourceRef: data.sourceRef ?? null,
    confidence: data.confidence,
    asOf: input.asOf ?? day,
    recordedAt: now,
  };
};

// Rows that fit the fact's kind; one that does not is left out rather than failing the read.
export function checked(inputs: readonly TaxFactInput[], day: string, now: Date): StoredFact[] {
  return inputs.flatMap((input) => {
    try {
      return [asStored(input, day, now)];
    } catch {
      return [];
    }
  });
}

export async function readRows(userId: string, taxYear: number, client: PrismaClient) {
  const db = scopedFor(userId, client);
  const [facts, members] = await Promise.all([
    db.taxFacts.findMany({
      where: { taxYear: { in: [taxYear, NOT_YEAR_SCOPED] }, supersededAt: null },
      select: {
        key: true,
        memberKey: true,
        value: true,
        status: true,
        origin: true,
        sourceRef: true,
        confidence: true,
        asOf: true,
        recordedAt: true,
        taxYear: true,
      },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    }),
    db.taxHouseholdMembers.findMany({
      where: { taxYear, removedAt: null },
      select: { memberKey: true, label: true, relationship: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  return {
    facts: facts.map((f): StoredFact & { taxYear: number } => ({
      ...f,
      asOf: isoDay(f.asOf),
    })),
    members: members.map((m): Member => ({
      key: m.memberKey,
      label: m.label,
      relationship: m.relationship,
    })),
  };
}

const REPAIR_TRIES = 2;

// Rows the older stores own, which a copy made now replaces.
const ownedByOldStores = (r: StoredFact) =>
  (OWN_WORD_ORIGINS as readonly string[]).includes(r.origin) &&
  ((r.memberKey === "self" && (OLD_STORE_KEYS as readonly string[]).includes(r.key)) ||
    (isProfileMember(r.memberKey) && (OLD_STORE_MEMBER_KEYS as readonly string[]).includes(r.key)));

export async function loadTaxHousehold(
  userId: string,
  taxYear: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TaxHousehold> {
  const today = await todayOf(userId, { client, now });
  const sample = isTrialUser(userId) || (await onlyDemoBank(userId, client));
  let { facts, members } = await readRows(userId, taxYear, client);
  const repaired = facts.some(
    (f) =>
      f.key === LEGACY_DONE_KEY &&
      f.taxYear === taxYear &&
      (f.value as { v?: unknown } | null)?.v === true,
  );
  // What Jane found in the accounts: read each time, cached for the day, never stored.
  const { found } = await loadTaxFacts(userId, { client, now });
  let rows: StoredFact[] = [...facts];
  if (!repaired) {
    const sources = await readLegacySources(userId, taxYear, { client, now });
    let stored = false;
    if (!sample) {
      for (let attempt = 1; !stored && attempt <= REPAIR_TRIES; attempt += 1) {
        try {
          await repairRecord(userId, taxYear, sources, facts, { client, now });
          ({ facts, members } = await readRows(userId, taxYear, client));
          rows = [...facts];
          stored = true;
        } catch (error) {
          // A read that cannot write its copy still answers, from the copy in memory.
          if (attempt === REPAIR_TRIES)
            log.warn("tax household: copying the older answers in failed", {
              error: error instanceof Error ? error.message : "unknown",
            });
        }
      }
    }
    if (!stored) {
      const copy = legacyRows(sources);
      // The copy says what the older stores say now: it replaces what the record holds of theirs.
      rows = [...rows.filter((r) => !ownedByOldStores(r)), ...checked(copy.facts, today, now)];
      const asStore = new Set(copy.members.map((m) => m.memberKey));
      const have = new Set(members.map((m) => m.key));
      members = [
        ...members.filter((m) => !isProfileMember(m.key) || asStore.has(m.key)),
        ...copy.members
          .filter((m) => !have.has(m.memberKey))
          .map((m) => ({ key: m.memberKey, label: m.label, relationship: m.relationship })),
      ];
    }
  }
  const merged = new Map(mergeFacts(rows));
  // A made-up person is a US citizen (as src/lib/tax-residency.ts reads them), until they answer.
  const ephemeral: TaxFactInput[] = [];
  if (sample && !merged.has(factId("self", "residency.status")))
    ephemeral.push({
      key: "residency.status",
      value: "citizen_or_green_card",
      taxYear,
      origin: "legacy",
      asOf: today,
      sourceRef: "sample person",
    });
  const seen = foundRows(found, taxYear, today);
  for (const [id, fact] of mergeFacts(checked([...ephemeral, ...seen.facts], today, now))) {
    if (!merged.has(id)) merged.set(id, fact);
  }
  const stated = merged.has(factId("self", "household.dependants_stated"));
  const withFound = members.length === 0 && !stated ? seen.members : [];
  return {
    userId,
    taxYear,
    today,
    facts: merged,
    members: [
      ...members,
      ...withFound.map((m): Member => ({
        key: m.memberKey,
        label: m.label,
        relationship: m.relationship,
      })),
    ],
  };
}
