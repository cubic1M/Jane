import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@/generated/prisma/client";

// A read cache for one piece of background work (a bank sync and everything it sets off): the
// same person's facts, asked for again and again by the detectors, Jane's brief, the practice
// replay and the numbers saved for Claude, are read once (a demo sync asked whether the person is
// in demo advice mode 248 times, and loaded the detection input 72 times, 6,000 queries in all).
// React's cache does this for a page render; this does it where there is no render.
//
// It can never serve a stale read: the work runs with a client that clears the whole cache on
// any write or raw query made through it (or through anything built on it, like scopedFor), so
// a cached value is only ever one read since the last change. Outside a scope nothing is cached.

type Scope = { cache: Map<string, Promise<unknown>>; client: PrismaClient };

const scopes = new AsyncLocalStorage<Scope>();

// Prisma operations that only read; anything else (and every raw query) clears the cache.
const READS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

// The client to use inside a scope: the same database, with a write clearing the scope's cache.
function tracked(client: PrismaClient, scope: () => Scope | undefined): PrismaClient {
  return client.$extends({
    query: {
      $allOperations({ operation, args, query }) {
        if (!READS.has(operation)) scope()?.cache.clear();
        return query(args);
      },
    },
  }) as unknown as PrismaClient;
}

// Runs `work` with a read cache, handing it the client to use. Nested scopes share the outer one.
export async function withReadCache<T>(
  client: PrismaClient,
  work: (client: PrismaClient) => Promise<T>,
): Promise<T> {
  const outer = scopes.getStore();
  // A nested call shares the outer cache; a stand-in client (a test's stub) gets none.
  if (outer || typeof client.$extends !== "function") return work(client);
  const scope: Scope = { cache: new Map(), client };
  const wrapped = tracked(client, () => scopes.getStore());
  scope.client = wrapped;
  return scopes.run(scope, () => work(wrapped));
}

// A read through the cache: `key` names what is read and for whom; `client` must be the scope's
// own (anything else, such as another test's client, reads afresh). A failed read isn't kept.
export function cachedRead<T>(
  key: string,
  client: PrismaClient,
  read: () => Promise<T>,
): Promise<T> {
  const scope = scopes.getStore();
  if (!scope || scope.client !== client) return read();
  const hit = scope.cache.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const value = read();
  scope.cache.set(key, value);
  value.catch(() => {
    if (scope.cache.get(key) === value) scope.cache.delete(key);
  });
  return value;
}

// The same, handing each caller its own copy of what was read, for values a caller may change.
export async function cachedCopy<T>(
  key: string,
  client: PrismaClient,
  read: () => Promise<T>,
): Promise<T> {
  const scope = scopes.getStore();
  if (!scope || scope.client !== client) return read();
  return structuredClone(await cachedRead(key, client, read));
}

// Whether a read cache is on (for tests).
export const inReadCache = () => scopes.getStore() !== undefined;
