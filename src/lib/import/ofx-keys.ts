import { isoDay } from "@/lib/dates";

// A bank's row id (FITID) is an id only within its own account, so another account's file (or a
// later file of this one) can reuse it for a different transaction. A row whose id is taken by a
// different day or amount is kept under a key of its own: the id, the day and the amount.

export type KeyedRow = { externalId: string; date: string; amountCents: number };

export const isOfxKey = (externalId: string) => externalId.startsWith("ofx:");

export const reusedIdKey = (row: KeyedRow) => `${row.externalId}|${row.date}|${row.amountCents}`;

// Every key a row may be stored under: its own id, and the key it gets when the id was reused.
export const storedKeysOf = (row: KeyedRow): string[] =>
  isOfxKey(row.externalId) ? [row.externalId, reusedIdKey(row)] : [row.externalId];

// Whether a stored row (its key, day and amount) is this very row.
export function isStoredCopy(
  stored: { dedupeKey: string | null; date: Date; amountCents: number },
  row: KeyedRow,
): boolean {
  if (!isOfxKey(row.externalId)) return stored.dedupeKey === row.externalId;
  return (
    stored.dedupeKey === reusedIdKey(row) ||
    (stored.dedupeKey === row.externalId &&
      isoDay(stored.date) === row.date &&
      stored.amountCents === row.amountCents)
  );
}
