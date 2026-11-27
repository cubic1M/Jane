import { LEGACY_DONE_KEY, NOT_YEAR_SCOPED, isTaxFactKey, taxFactSpec } from "@/config/tax-facts";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { isoDay } from "@/lib/dates";
import { db as defaultClient } from "@/lib/db";
import { personTransaction, scopedFor } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { onlyDemoBank } from "@/lib/only-demo-bank";
import { foundRows, legacyRows, readLegacySources, type LegacyRows } from "@/lib/tax-facts/legacy";
import { loadTaxFacts } from "@/lib/tax-profile";
import { storedFactData, type TaxFactInput } from "@/lib/tax-facts/write";
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
// copied in (read-repair, src/lib/tax-facts/legacy.ts), once, and the marker fact
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
function checked(inputs: readonly TaxFactInput[], day: string, now: Date): StoredFact[] {
  return inputs.flatMap((input) => {
    try {
      return [asStored(input, day, now)];
    } catch {
      return [];
    }
  });
}

async function readRows(userId: string, taxYear: number, client: PrismaClient) {
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

// Copies the person's older answers in, once for the year. Safe to run twice at once: a duplicate
// row is skipped by the database (the partial unique index), and the marker goes in last.
async function repair(
  userId: string,
  taxYear: number,
  copy: LegacyRows,
  day: string,
  client: PrismaClient,
): Promise<void> {
  const data = copy.facts.flatMap((input) => {
    try {
      return [storedFactData(userId, input, day)];
    } catch {
      return [];
    }
  });
  const marker = storedFactData(
    userId,
    {
      key: LEGACY_DONE_KEY,
      value: true,
      taxYear,
      origin: "legacy",
      sourceRef: "read-repair",
      asOf: day,
    },
    day,
  );
  // Written to the audit log first: an entry for a copy that then fails is a harmless extra, a copy
  // with no entry is not (and the marker means it is never written again).
  const sensitive = new Set(
    data
      .filter((d) => isTaxFactKey(d.key) && taxFactSpec(d.key).sensitive)
      .map((d) => `${d.key}|${d.origin}`),
  );
  for (const entry of sensitive) {
    const [key, origin] = entry.split("|");
    await logAudit(
      { type: "user", id: userId },
      "tax_fact_recorded",
      { type: "user", id: userId },
      { key, origin },
    );
  }
  await personTransaction(
    userId,
    async (tx) => {
      await tx.taxFact.createMany({ data: [...data, marker], skipDuplicates: true });
      await tx.taxHouseholdMember.createMany({
        data: copy.members.map((m) => ({ ...m, userId, taxYear })),
        skipDuplicates: true,
      });
    },
    client,
  );
}

export async function loadTaxHousehold(
  userId: string,
  taxYear: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TaxHousehold> {
  const today = await todayOf(userId, { client, now });
  const sample = isTrialUser(userId) || (await onlyDemoBank(userId, client));
  let { facts, members } = await readRows(userId, taxYear, client);
  const repaired = facts.some((f) => f.key === LEGACY_DONE_KEY && f.taxYear === taxYear);
  // What Jane found in the accounts: read each time, cached for the day, never stored.
  const { found } = await loadTaxFacts(userId, { client, now });
  const rows: StoredFact[] = [...facts];
  const copy = repaired
    ? { facts: [], members: [] }
    : legacyRows(await readLegacySources(userId, taxYear, { client, now }));
  if (!repaired) {
    let stored = false;
    if (!sample) {
      try {
        await repair(userId, taxYear, copy, today, client);
        ({ facts, members } = await readRows(userId, taxYear, client));
        rows.length = 0;
        rows.push(...facts);
        stored = true;
      } catch (error) {
        // A read that cannot write its copy still answers, from the copy in memory.
        log.warn("tax household: copying the older answers in failed", {
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    if (!stored) {
      rows.push(...checked(copy.facts, today, now));
      // The members already stored stay; the copy adds the ones it has that they do not.
      const have = new Set(members.map((m) => m.key));
      members = [
        ...members,
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
