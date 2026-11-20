import type { Flat } from "./diff";

// The same data reads the same (manager, 11-20): one person made twice from the same statements or
// the same bank, read at the same moment, sees the same thing, in the same order. Their ids, and
// what is built from ids (a finding's key, an evidence row's path, a fingerprint), are theirs alone,
// so they're masked; everything else must match. Two sweep runs named the fee card's funds in two
// orders (#2165). Pure.

// A row's id (cuid), a hash or fingerprint, and the test's own email for each copy.
const PER_PERSON = /\bc[a-z0-9]{24}\b|\b[0-9a-f]{24,64}\b|\b[\w.-]+@example\.test\b/g;
const masked = (text: string) => text.replace(PER_PERSON, "…");

// Each path and value with ids masked. Paths that differ only by an id (two findings keyed by their
// accounts) are kept as many as there are, so neither hides the other.
function lines(flat: Flat): string[] {
  return Object.entries(flat)
    .map(
      ([path, value]) =>
        `${masked(path)} = ${typeof value === "string" ? masked(value) : JSON.stringify(value)}`,
    )
    .sort();
}

// What one copy shows that the other doesn't, line by line; empty when they read the same.
export function sameTwice(first: Flat, second: Flat): string[] {
  const a = lines(first);
  const b = lines(second);
  const left = new Map<string, number>();
  for (const line of a) left.set(line, (left.get(line) ?? 0) + 1);
  const onlySecond: string[] = [];
  for (const line of b) {
    const n = left.get(line) ?? 0;
    if (n > 0) left.set(line, n - 1);
    else onlySecond.push(`second: ${line}`);
  }
  const onlyFirst = [...left].flatMap(([line, n]) =>
    Array.from({ length: n }, () => `first: ${line}`),
  );
  return [...onlyFirst, ...onlySecond];
}
