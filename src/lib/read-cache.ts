import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@/generated/prisma/client";

// A read cache for one piece of background work (a bank sync and everything it sets off): the
// same person's facts, asked for again and again by the detectors, Jane's brief, the practice
// replay and the numbers saved for Claude, are read once (a demo sync asked whether the person is
// in demo advice mode 248 times, and loaded the detection input 72 times, 6,000 queries in all).
// React's cache does this for a page render; this does it where there is no render.
//
// It can never serve a stale read: the work runs with a client that sees every write and raw
// query made through it (or through anything built on it, like scopedFor), and notes the tables
// each value was read from, related ones included. A write to one table forgets what was read
// from that table; a write it can't pin to one table (a delete, which may cascade, a write to a
// relation, a raw query) forgets everything, as does any write while a value is still being
// worked out. Outside a scope nothing is cached.

// The tables a cached value was worked out from: `all` when they can't all be named.
type Reads = { models: Set<string>; all: boolean };
type Entry = { value: Promise<unknown>; reads: Reads; done: boolean };
type Scope = { cache: Map<string, Entry>; client: PrismaClient };

const scopes = new AsyncLocalStorage<Scope>();
// The reads of the value being worked out right now, if any.
const collecting = new AsyncLocalStorage<Reads>();

// Prisma operations that only read; anything else (and every raw query) is a write.
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

// Each table's relations, from the client's own data model: field name to related table. Null
// when the client doesn't carry one (Prisma's internals moved): then no read can be traced to
// its tables, and every write forgets everything.
type Relations = Map<string, Map<string, string>>;
type DataModel = {
  models: Record<string, { fields: { name: string; kind: string; type: string }[] }>;
};
const relationsOf = new WeakMap<object, Relations>();
function relations(client: PrismaClient): Relations | null {
  const model = (client as unknown as { _runtimeDataModel?: DataModel })._runtimeDataModel;
  if (!model?.models) return null;
  let found = relationsOf.get(model);
  if (!found) {
    found = new Map(
      Object.entries(model.models).map(([name, { fields }]) => [
        name,
        new Map(fields.filter((f) => f.kind === "object").map((f) => [f.name, f.type])),
      ]),
    );
    relationsOf.set(model, found);
  }
  return found;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !(v instanceof Date) && !Array.isArray(v);

// The keys of a relation filter: `accounts: { some: {...} }`, `item: { is: {...} }`.
const RELATION_FILTERS = new Set(["some", "every", "none", "is", "isNot"]);

// Adds every table a read on `model` with `args` reads: the table itself, and each related one
// it includes, selects, counts, filters or orders by.
function tablesOf(rel: Relations, model: string, args: unknown, out: Set<string>) {
  out.add(model);
  if (!isObject(args)) return;
  const of = rel.get(model) ?? new Map<string, string>();
  for (const key of ["include", "select"]) {
    const picked = args[key];
    if (!isObject(picked)) continue;
    for (const [field, value] of Object.entries(picked)) {
      if (!value) continue;
      if (field === "_count") {
        // Every relation, or the ones its select names.
        const counted =
          isObject(value) && isObject(value.select)
            ? Object.entries(value.select)
            : [...of.keys()].map((f) => [f, true]);
        for (const [f, v] of counted) {
          const target = of.get(f as string);
          if (target && v) tablesOf(rel, target, isObject(v) ? v : undefined, out);
        }
        continue;
      }
      const target = of.get(field);
      if (target) tablesOf(rel, target, value, out);
    }
  }
  whereTables(rel, model, args.where, out);
  const orders = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
  for (const order of orders) {
    if (!isObject(order)) continue;
    for (const [field, value] of Object.entries(order)) {
      const target = of.get(field);
      if (target) tablesOf(rel, target, { orderBy: value }, out);
    }
  }
}

function whereTables(rel: Relations, model: string, where: unknown, out: Set<string>) {
  if (!isObject(where)) return;
  const of = rel.get(model) ?? new Map<string, string>();
  for (const [key, value] of Object.entries(where)) {
    if (key === "AND" || key === "OR" || key === "NOT") {
      for (const w of Array.isArray(value) ? value : [value]) whereTables(rel, model, w, out);
      continue;
    }
    const target = of.get(key);
    if (!target) continue;
    out.add(target);
    if (!isObject(value)) continue;
    const wrapped = Object.keys(value).some((k) => RELATION_FILTERS.has(k));
    for (const inner of wrapped ? Object.values(value) : [value])
      whereTables(rel, target, inner, out);
  }
}

// The one table a write changes, or null when it may change others (a delete may cascade; a
// write that names a relation writes the related table) or can't be named (a raw query).
function writeOf(
  rel: Relations | null,
  model: string | undefined,
  operation: string,
  args: Record<string, unknown> | undefined,
) {
  if (!rel || !model || !rel.has(model)) return null;
  if (operation === "delete" || operation === "deleteMany") return null;
  const of = rel.get(model) ?? new Map<string, string>();
  const rows = [args?.data, args?.create, args?.update].flatMap((d) =>
    Array.isArray(d) ? d : [d],
  );
  for (const row of rows) {
    if (row === undefined) continue;
    if (!isObject(row)) return null;
    if (Object.keys(row).some((k) => of.has(k))) return null;
  }
  return model;
}

// Forgets what a write to `model` (null: to anything) may have changed. A value still being
// worked out may already have read the table, so it goes too.
function forget(scope: Scope, model: string | null) {
  for (const [key, entry] of scope.cache) {
    const { models, all } = entry.reads;
    // A finished value that read no table through the scope's client: nothing to go on.
    const unknown = all || models.size === 0;
    if (model === null || !entry.done || unknown || models.has(model)) scope.cache.delete(key);
  }
}

// The client to use inside a scope: the same database, noting what each value reads and
// forgetting values on writes.
function tracked(client: PrismaClient, scope: () => Scope | undefined): PrismaClient {
  const rel = relations(client);
  return client.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        const params = args as Record<string, unknown> | undefined;
        if (READS.has(operation)) {
          const reads = collecting.getStore();
          if (reads) {
            if (rel && model && rel.has(model)) tablesOf(rel, model, params, reads.models);
            else reads.all = true;
          }
        } else {
          const current = scope();
          if (current) forget(current, writeOf(rel, model, operation, params));
        }
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

// A value worked out from another cached value read the tables that one read.
function inherit(entry: Entry) {
  const outer = collecting.getStore();
  if (!outer) return;
  const merge = () => {
    if (entry.reads.all) outer.all = true;
    for (const m of entry.reads.models) outer.models.add(m);
  };
  if (entry.done) merge();
  else entry.value.then(merge, () => {});
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
  const hit = scope.cache.get(key);
  if (hit) {
    inherit(hit);
    return hit.value as Promise<T>;
  }
  const reads: Reads = { models: new Set(), all: false };
  // Awaited inside, so a lazy query (Prisma's run when awaited) runs as part of this value.
  const value = collecting.run(reads, async () => await read());
  const entry: Entry = { value, reads, done: false };
  scope.cache.set(key, entry);
  value.then(
    () => {
      entry.done = true;
    },
    () => {
      if (scope.cache.get(key) === entry) scope.cache.delete(key);
    },
  );
  inherit(entry);
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
