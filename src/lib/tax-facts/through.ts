import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { log } from "@/lib/log";
import { onlyDemoBank } from "@/lib/only-demo-bank";
import { legacyRows, readLegacySources, type LegacySources } from "@/lib/tax-facts/legacy";
import { readRows } from "@/lib/tax-facts/load";
import { markNeedsRepair, repairRecord } from "@/lib/tax-facts/repair";
import { KEYS_OF_TOLD } from "@/lib/tax-facts/told";
import { forgetTaxFacts } from "@/lib/tax-facts/write";
import { isTrialUser } from "@/lib/trial-ids";
import { todayOf } from "@/lib/today";
import { defaultTaxYear } from "@/planning/tax-pack";

// Keeping the household record in step with the older stores (tax roadmap 1.3, step T9). The older
// stores stay the source of truth for now, so every writer of one calls syncRecord after it has
// written: the record for the year the person is working on (defaultTaxYear of their own day) is
// brought in line with what the stores now say, in one transaction, and every other year is marked
// to be copied again the next time it is read. A sync that fails is never lost: it marks the record
// to be copied again, so the next read of the household puts it right (and the nightly accuracy
// run counts any household that still differs). A person who takes an answer back also has every
// row of it removed for good (forgetToldRecord): the current and the superseded, in every year.

type Options = { client?: PrismaClient; now?: Date };

const SYNC_PASSES = 3;

// Whether two readings of the stores give the same rows (what the copy is made of).
const sameCopy = (a: LegacySources, b: LegacySources) =>
  JSON.stringify(legacyRows(a)) === JSON.stringify(legacyRows(b));

// The record in line with the older stores, for the person's working year. Never throws: a sync that
// cannot be made marks the record instead.
export async function syncRecord(userId: string, options: Options = {}): Promise<void> {
  const { client = defaultClient, now = new Date() } = options;
  try {
    // A sample person and a trial person leave no trace in the record.
    if (isTrialUser(userId) || (await onlyDemoBank(userId, client))) return;
    const year = defaultTaxYear(await todayOf(userId, { client, now }));
    // Copy, then read the stores again: a store written by another request while this one was
    // reading is copied too, so the record cannot end up holding the older of two answers.
    let sources = await readLegacySources(userId, year, { client, now });
    for (let pass = 1; pass <= SYNC_PASSES; pass += 1) {
      const { facts } = await readRows(userId, year, client);
      await repairRecord(userId, year, sources, facts, { client, now, sync: true });
      const after = await readLegacySources(userId, year, { client, now });
      if (sameCopy(sources, after)) break;
      sources = after;
    }
    await markNeedsRepair(userId, { client, exceptYear: year });
  } catch (error) {
    log.error("tax household: the record was not updated", {
      error: error instanceof Error ? error.message : "unknown",
    });
    try {
      await markNeedsRepair(userId, { client });
    } catch (again) {
      // Nothing more can be done here: the nightly accuracy run counts a household that differs.
      log.error("tax household: the record could not be marked to be copied again", {
        error: again instanceof Error ? again.message : "unknown",
      });
    }
  }
}

// The person took a told fact back, or erased everything Jane remembers ("all"): the rows of what
// they said are removed for good, then the record is brought in line with the stores, which give
// back only what they still hold in their own right (the tax profile's own answers).
export async function forgetToldRecord(
  userId: string,
  what: string | "all",
  options: Options = {},
): Promise<void> {
  const keys =
    what === "all" ? [...new Set(Object.values(KEYS_OF_TOLD).flat())] : KEYS_OF_TOLD[what];
  if (!keys) return;
  const { client = defaultClient } = options;
  try {
    await forgetTaxFacts(userId, { keys }, { client });
  } catch (error) {
    log.error("tax household: the answer was not removed from the record", {
      error: error instanceof Error ? error.message : "unknown",
    });
    try {
      await markNeedsRepair(userId, { client });
    } catch {
      // As above: the nightly run counts it.
    }
    return;
  }
  await syncRecord(userId, options);
}
