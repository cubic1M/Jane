import { normalizeDescription } from "@/data-sources/merchant";

// Uploading a file again is the only way rows read wrongly can be put right: raw files aren't kept
// (debugger 11-02: fixes to how a file is read never reached anyone who had uploaded it before).
// Pure: what the file's rows change in the rows already stored.
//
// The same row (same key): its category and name follow the new reading, unless the person chose
// the category, or it's a card payment found by its timing (./reapply.ts keeps those too).
//
// A row read differently (a sign or a description wrong before, so another key): saving it would
// count it twice, so the stored row is corrected in place, keeping its id and everything tied to
// it. A row pairs with a stored row of that day and amount, sign aside, that the file doesn't have
// and whose description is on none of the file's rows. Only when much of what's new pairs, as it
// does when a whole file was misread: one new -$50 beside an old +$50 is two real transactions.
//
// A row stored at $0.00 had its money missed (debugger 11-02: YNAB read with Outflow alone), so it
// pairs by day and words instead: the file has its description, with the amount at last.

const CARD_PAYMENT = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
const USER = "user";
export const MISREAD_MIN_ROWS = 2;
export const MISREAD_MIN_SHARE = 0.5;

export type StoredRow = {
  id: string;
  dedupeKey: string | null;
  date: string;
  amountCents: number;
  description: string;
  merchantName: string | null;
  pfcDetailed: string | null;
  categorySource: string | null;
};

export type IncomingRow = {
  externalId: string;
  date: string;
  amountCents: number;
  description: string;
  merchantName: string | null;
  category: { primary: string; detailed: string } | null;
  categorySource: string | null;
};

export type Correction = {
  id: string;
  data: {
    dedupeKey?: string;
    amountCents?: number;
    description?: string;
    merchantName?: string | null;
    pfcPrimary?: string | null;
    pfcDetailed?: string | null;
    categorySource?: string | null;
  };
};

const categoryOf = (row: IncomingRow) => ({
  pfcPrimary: row.category?.primary ?? null,
  pfcDetailed: row.category?.detailed ?? null,
  categorySource: row.categorySource,
});

const ownCategory = (row: StoredRow) =>
  row.categorySource === USER || row.pfcDetailed === CARD_PAYMENT;

function sameRow(stored: StoredRow, row: IncomingRow): Correction | null {
  const data: Correction["data"] = {};
  if (row.merchantName && row.merchantName !== stored.merchantName) {
    data.merchantName = row.merchantName;
  }
  if (!ownCategory(stored) && row.category && row.category.detailed !== stored.pfcDetailed) {
    Object.assign(data, categoryOf(row));
  }
  return Object.keys(data).length > 0 ? { id: stored.id, data } : null;
}

const pairsWith = (stored: StoredRow, row: IncomingRow) =>
  stored.amountCents === 0
    ? normalizeDescription(row.description).startsWith(normalizeDescription(stored.description))
    : Math.abs(stored.amountCents) === Math.abs(row.amountCents);

export function planCorrections(
  stored: readonly StoredRow[],
  incoming: readonly IncomingRow[],
): { corrections: Correction[]; rekeyed: Set<string> } {
  const byKey = new Map(stored.map((s) => [s.dedupeKey, s]));
  const keys = new Set(incoming.map((r) => r.externalId));
  const corrections: Correction[] = [];
  for (const row of incoming) {
    const twin = byKey.get(row.externalId);
    const correction = twin && sameRow(twin, row);
    if (correction) corrections.push(correction);
  }

  const inFile = new Set(incoming.map((r) => normalizeDescription(r.description)));
  const unused = stored.filter(
    (s) =>
      !keys.has(s.dedupeKey ?? "") &&
      (s.amountCents === 0 || !inFile.has(normalizeDescription(s.description))),
  );
  const fresh = incoming.filter((r) => !byKey.has(r.externalId));
  const pairs: [StoredRow, IncomingRow][] = [];
  for (const row of fresh) {
    const at = unused.findIndex((s) => s.date === row.date && pairsWith(s, row));
    if (at === -1) continue;
    pairs.push([unused[at], row]);
    unused.splice(at, 1);
  }
  const rekeyed = new Set<string>();
  if (pairs.length >= MISREAD_MIN_ROWS && pairs.length >= fresh.length * MISREAD_MIN_SHARE) {
    for (const [old, row] of pairs) {
      rekeyed.add(row.externalId);
      corrections.push({
        id: old.id,
        data: {
          dedupeKey: row.externalId,
          amountCents: row.amountCents,
          description: row.description,
          merchantName: row.merchantName,
          ...(ownCategory(old) ? {} : categoryOf(row)),
        },
      });
    }
  }
  return { corrections, rekeyed };
}
