import {
  TAX_FACT_PRECEDENCE,
  type FactOrigin,
  type StoredFactStatus,
  type TaxFactKey,
} from "@/config/tax-facts";

// The household's tax facts, pure (tax roadmap 1.3, step T9). The loader (src/lib/tax-facts/load.ts)
// reads the stored rows; mergeFacts settles them; the rules ask `fact(household, key)` and get a
// value, or an honest "unknown". Nothing here reads the database or the clock.

export type FactStatus = StoredFactStatus | "unknown";
export type { FactOrigin };

// Another current value that disagrees with the one used.
export type FactConflict<T> = Readonly<{ value: T; origin: FactOrigin; asOf: string }>;

export type TaxFact<T> = Readonly<{
  key: TaxFactKey;
  member: string;
  value: T | null;
  status: FactStatus;
  origin: FactOrigin | null;
  sourceRef: string | null;
  // Whole percent; 0 for an unknown fact.
  confidence: number;
  // The person's own day the fact was true, or null when unknown.
  asOf: string | null;
  conflicts: readonly FactConflict<T>[];
}>;

export type Member = Readonly<{ key: string; label: string; relationship: string }>;

// A stored row as the merge reads it. `value` is the column's JSON, { v: ... }.
export type StoredFact = Readonly<{
  key: string;
  memberKey: string;
  value: unknown;
  status: string;
  origin: string;
  sourceRef: string | null;
  confidence: number;
  // ISO day.
  asOf: string;
  recordedAt: Date;
  supersededAt?: Date | null;
}>;

export type TaxHousehold = Readonly<{
  userId: string;
  taxYear: number;
  // The person's own day (todayOf), not UTC's.
  today: string;
  // Keyed `${member}/${key}`.
  facts: ReadonlyMap<string, TaxFact<unknown>>;
  members: readonly Member[];
}>;

export const factId = (member: string, key: string) => `${member}/${key}`;

const unknownFact = (key: TaxFactKey, member: string): TaxFact<never> => ({
  key,
  member,
  value: null,
  status: "unknown",
  origin: null,
  sourceRef: null,
  confidence: 0,
  asOf: null,
  conflicts: [],
});

export function fact<T>(h: TaxHousehold, key: TaxFactKey, member = "self"): TaxFact<T> {
  return (h.facts.get(factId(member, key)) as TaxFact<T> | undefined) ?? unknownFact(key, member);
}

const valueOf = (stored: unknown): unknown => (stored as { v?: unknown } | null)?.v;

const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

const rank = (origin: string) => {
  const i = TAX_FACT_PRECEDENCE.indexOf(origin as FactOrigin);
  return i === -1 ? TAX_FACT_PRECEDENCE.length : i;
};

// The newest first: the person's later day, then the later write.
const newer = (a: StoredFact, b: StoredFact) =>
  a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : b.recordedAt.getTime() - a.recordedAt.getTime();

// For each (member, key), the current value is the first current row in the precedence order
// (answer, document, connector, transaction, legacy), the newest first among rows of one origin.
// Every other current row that says something else is kept as a conflict, never dropped. A row that
// is superseded is history and is ignored. Unknown means there is no row; it is never stored.
export function mergeFacts(rows: readonly StoredFact[]): TaxHousehold["facts"] {
  const groups = new Map<string, StoredFact[]>();
  for (const row of rows) {
    if (row.supersededAt) continue;
    const id = factId(row.memberKey, row.key);
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  const merged = new Map<string, TaxFact<unknown>>();
  for (const [id, group] of groups) {
    const ordered = [...group].sort((a, b) => rank(a.origin) - rank(b.origin) || newer(a, b));
    const [best] = ordered;
    const value = valueOf(best.value);
    const seen = new Set<string>();
    const conflicts: FactConflict<unknown>[] = [];
    for (const other of ordered.slice(1)) {
      const v = valueOf(other.value);
      const mark = `${other.origin}:${other.asOf}:${JSON.stringify(v)}`;
      if (sameValue(v, value) || seen.has(mark)) continue;
      seen.add(mark);
      conflicts.push({ value: v, origin: other.origin as FactOrigin, asOf: other.asOf });
    }
    merged.set(id, {
      key: best.key as TaxFactKey,
      member: best.memberKey,
      value,
      status: best.status === "inferred" ? "inferred" : "known",
      origin: best.origin as FactOrigin,
      sourceRef: best.sourceRef,
      confidence: best.confidence,
      asOf: best.asOf,
      conflicts,
    });
  }
  return merged;
}

// The members of the household who are still in it, in the order they were added.
export const membersOf = (h: TaxHousehold, relationship?: string): readonly Member[] =>
  h.members.filter((m) => relationship === undefined || m.relationship === relationship);
