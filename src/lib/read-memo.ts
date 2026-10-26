import { cache } from "react";

// One server render reads the same rows over and over: /home asked for a person's accounts 94
// times, their transactions 83 times, their bank links 82 times (each area's tree loader, and each
// tile, reads the base tables again). Reads through the user-scoped client (src/lib/db-scoped.ts)
// that ask for exactly the same thing share one answer for the length of the render, and any
// write through the client forgets them all, so a page that changes something and then reads it
// back sees the change. Outside a server render React's cache is a pass-through, so jobs, route
// handlers and tests are untouched.

export const READ_OPERATIONS: ReadonlySet<string> = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

export type Store = Map<string, Promise<unknown>>;

// The render's own store: React's cache gives each server render a fresh one.
const renderStore = cache((): Store => new Map());

// The question, as a string. null when it can't be told apart safely (a bigint, or an object
// that isn't plain data, like a Prisma null marker): that read just isn't shared.
export function memoKey(userId: string, model: string, operation: string, args: unknown) {
  let plain = true;
  try {
    const json = JSON.stringify(args, (_key, value) => {
      if (typeof value === "bigint") plain = false;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) plain = false;
      }
      return value;
    });
    return plain ? `${userId}|${model}|${operation}|${json}` : null;
  } catch {
    return null;
  }
}

// Whoever asks gets their own copy of the rows, so one page section sorting or editing a list
// can't change what another section reads: the array and each plain row are copied one level.
export function copyRows<T>(result: T): T {
  const copyRow = (row: unknown) =>
    row && typeof row === "object" && Object.getPrototypeOf(row) === Object.prototype
      ? { ...(row as object) }
      : row;
  if (Array.isArray(result)) return result.map(copyRow) as T;
  return copyRow(result) as T;
}

export function memoRead(
  key: string | null,
  run: () => Promise<unknown>,
  store: Store = renderStore(),
): Promise<unknown> {
  if (key === null) return run();
  let answer = store.get(key);
  if (!answer) {
    answer = run();
    store.set(key, answer);
    // A failed read isn't kept: the next ask tries again.
    answer.catch(() => {
      if (store.get(key) === answer) store.delete(key);
    });
  }
  return answer.then(copyRows);
}

export function forgetReads(store: Store = renderStore()) {
  store.clear();
}
