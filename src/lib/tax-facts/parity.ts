import { LEGACY_DONE_KEY } from "@/config/tax-facts";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { checked, readRows } from "@/lib/tax-facts/load";
import { isProfileMember, legacyRows, readLegacySources } from "@/lib/tax-facts/legacy";
import { todayOf } from "@/lib/today";
import { mergeFacts, type StoredFact } from "@/planning/tax-engine/facts";
import { defaultTaxYear } from "@/planning/tax-pack";

// Does the household record say what the older stores say (tax roadmap 1.3, step T9)? Until the record
// is the source of truth the older stores are, so a write that did not land shows up here: the
// nightly accuracy run (src/lib/invariants/accuracy.ts) counts it, by check name and number of
// people, never a value. Reads only: it never copies or repairs, so a difference is seen.

export const TAX_FACT_PARITY = [
  {
    name: "tax_facts_filing_status",
    about: "The record's filing status is the one the older stores settle on",
  },
  {
    name: "tax_facts_residency",
    about: "The record's residency is what the person told Jane",
  },
  {
    name: "tax_facts_dependants",
    about: "The record holds as many dependants as the tax profile counts",
  },
  { name: "tax_facts_state", about: "The record's state is the tax profile's or the told one" },
] as const;

export type ParityName = (typeof TAX_FACT_PARITY)[number]["name"];

type Options = { client?: PrismaClient; now?: Date };

const valueOf = (rows: readonly StoredFact[], key: string): unknown =>
  (mergeFacts(rows).get(`self/${key}`)?.value ?? null) as unknown;

// null when the record has not been copied for the person's year yet (nothing to compare).
export async function taxFactParity(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Record<ParityName, boolean> | null> {
  const today = await todayOf(userId, { client, now });
  const year = defaultTaxYear(today);
  const { facts, members } = await readRows(userId, year, client);
  const copied = facts.some(
    (f) =>
      f.key === LEGACY_DONE_KEY &&
      f.taxYear === year &&
      (f.value as { v?: unknown } | null)?.v === true,
  );
  if (!copied) return null;
  const sources = await readLegacySources(userId, year, { client, now });
  const copy = legacyRows(sources);
  const wanted = checked(copy.facts, today, now);
  const same = (key: string) =>
    JSON.stringify(valueOf(facts, key)) === JSON.stringify(valueOf(wanted, key));
  return {
    tax_facts_filing_status: same("filing.status"),
    tax_facts_residency: same("residency.status"),
    tax_facts_dependants:
      members.filter((m) => isProfileMember(m.key)).length === copy.members.length,
    tax_facts_state: same("home.state"),
  };
}
