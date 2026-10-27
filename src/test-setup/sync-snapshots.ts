import { createHash } from "node:crypto";
import { afterAll, expect, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { syncItem as SyncItem } from "@/lib/plaid/sync";

// Demo syncs, once per test file (CI's unit-test minutes, 2026-10-26: a demo person's first sync
// is about 16 seconds and 6,000 queries, and most integration files make the same person again
// and again). The first time a test file syncs a fresh demo person, the sync runs for real and
// what it wrote is kept in memory. When the same file syncs another person that is the same in
// every way that counts (the same demo person and day, the same moment, the same item flags, the
// same rows written before the sync, the same environment), that person is given a copy of those
// rows instead: every id, the person's id, the item's id and the demo seed rewritten to their
// own, exactly as their own sync would have written them, in one SQL pass.
//
// Kept to what is safe: only a demo item's first sync of a person with one bank, never a
// progressive sync, never in src/lib/plaid (whose tests are about syncing), and never where a
// file says SYNC_SNAPSHOTS=off. The snapshot lives in the file's own memory, so mocks and the
// encryption key are always the file's own.

type Row = Record<string, unknown>;
type Snapshot = {
  userId: string;
  itemId: string;
  seed: string;
  tables: Record<string, Row[]>;
  item: Row;
  user: Row;
  // The user columns the sync changed: only those are copied, the rest stay the person's own.
  userColumns: string[];
  result: Awaited<ReturnType<typeof SyncItem>>;
};

const snapshots = new Map<string, Snapshot>();

// Shared by the run's test files (src/test-setup/sync-snapshots-dir.ts makes the folder): a file
// gets a copy of a sync another file made, when everything in the key matches, its own mocked
// modules included. Without the folder (one file run on its own) only the file's own are kept.
async function load(key: string): Promise<Snapshot | null> {
  const kept = snapshots.get(key);
  if (kept) return kept;
  const dir = process.env.SYNC_SNAPSHOT_DIR;
  if (!dir) return null;
  const { readFile } = await import("node:fs/promises");
  try {
    const s = JSON.parse(await readFile(`${dir}/${key}.json`, "utf8")) as Snapshot;
    snapshots.set(key, s);
    return s;
  } catch {
    return null;
  }
}

async function save(key: string, s: Snapshot) {
  snapshots.set(key, s);
  const dir = process.env.SYNC_SNAPSHOT_DIR;
  if (!dir) return;
  const { rename, writeFile } = await import("node:fs/promises");
  const tmp = `${dir}/${key}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s));
  await rename(tmp, `${dir}/${key}.json`);
}

// Environment that differs between files without changing what a sync writes: the file's own
// encryption key, vitest's worker numbers, these snapshots' own switches. A variable set to ""
// counts as unset (some files stub PLAID_SECRET to "", others leave it out).
const PER_FILE_ENV = /^(TOKEN_ENCRYPTION_KEY|VITEST_POOL_ID|VITEST_WORKER_ID|SYNC_SNAPSHOT.*)$/;

// Files that start together all want the same first syncs: the first to ask syncs for real and
// holds a lock; the others wait for its snapshot (up to LOCK_WAIT_MS, then sync for real).
const LOCK_WAIT_MS = 90_000;
async function claim(key: string): Promise<"mine" | "theirs" | null> {
  const dir = process.env.SYNC_SNAPSHOT_DIR;
  if (!dir) return null;
  const { open } = await import("node:fs/promises");
  try {
    await (await open(`${dir}/${key}.lock`, "wx")).close();
    return "mine";
  } catch {
    return "theirs";
  }
}
async function release(key: string) {
  const dir = process.env.SYNC_SNAPSHOT_DIR;
  if (!dir) return;
  const { rm } = await import("node:fs/promises");
  await rm(`${dir}/${key}.lock`, { force: true });
}
async function waitFor(key: string): Promise<Snapshot | null> {
  const dir = process.env.SYNC_SNAPSHOT_DIR!;
  const { access } = await import("node:fs/promises");
  const until = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < until) {
    const s = await load(key);
    if (s) return s;
    // The lock gone with no snapshot: that sync failed; this one syncs for real.
    if (
      !(await access(`${dir}/${key}.lock`).then(
        () => true,
        () => false,
      ))
    )
      return null;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

// The modules this test file mocks: a sync under other mocks may write other rows.
let mockedModules: string[] | null = null;
async function mocksOfFile(): Promise<string[]> {
  if (mockedModules) return mockedModules;
  const path = expect.getState().testPath;
  const { readFile } = await import("node:fs/promises");
  const source = path ? await readFile(path, "utf8").catch(() => "") : "";
  mockedModules = [...source.matchAll(/vi\.(?:do)?[mM]ock\(\s*["'`]([^"'`]+)["'`]/g)]
    .map((m) => m[1])
    .sort();
  return mockedModules;
}

// The shared rows (outside any person) a copy points to must still be there; a file's cleanup
// may have removed some. Foreign keys from the user-owned tables to the others.
let sharedRefs: { table: string; column: string; target: string }[] | null = null;
async function sharedRowsExist(client: PrismaClient, s: Snapshot): Promise<boolean> {
  if (!sharedRefs) {
    const own = new Set(await tablesOf(client));
    const fks = await client.$queryRawUnsafe<{ t: string; c: string; ref: string }[]>(
      `SELECT tc.table_name AS t, kcu.column_name AS c, ccu.table_name AS ref
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
    );
    sharedRefs = fks
      .filter((f) => own.has(f.t) && !own.has(f.ref) && !["users", "plaid_items"].includes(f.ref))
      .map((f) => ({ table: f.t, column: f.c, target: f.ref }));
  }
  const wanted = new Map<string, Set<string>>();
  for (const ref of sharedRefs)
    for (const row of s.tables[ref.table] ?? []) {
      const v = row[ref.column];
      if (typeof v === "string") {
        if (!wanted.has(ref.target)) wanted.set(ref.target, new Set());
        wanted.get(ref.target)!.add(v);
      }
    }
  for (const [table, ids] of wanted) {
    const found = await client.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "${table}" WHERE id = ANY($1::text[])`,
      [...ids],
    );
    if (found[0].n !== ids.size) return false;
  }
  return true;
}
// What this file's demo syncs did, for CI's log: one line per file that synced any.
const tally = { real: 0, copied: 0, skipped: 0, ms: 0, people: [] as string[] };
afterAll(() => {
  if (tally.real + tally.copied + tally.skipped === 0) return;
  console.log(
    `[sync-snapshots] ${(expect.getState().testPath ?? "").replace(/.*\/src\//, "src/")}: ${tally.real} real (${Math.round(tally.ms / 1000)}s), ${tally.copied} copied, ${tally.skipped} not eligible; ${tally.people.join(" ")}`,
  );
});
let userTables: string[] | null = null;

// Columns holding a random token unique across everyone (src: the schema's unique indexes).
const TOKEN_COLUMNS = [
  "reply_token",
  "token_hash",
  "token",
  "session_token",
  "stripe_session_id",
  "endpoint",
];

const IGNORED_COLUMNS = /^(id|user_id|.*_id|created_at|updated_at)$/;

const off = () =>
  process.env.SYNC_SNAPSHOTS === "off" ||
  (expect.getState().testPath ?? "").includes("/src/lib/plaid/");

async function tablesOf(client: PrismaClient): Promise<string[]> {
  if (userTables) return userTables;
  const rows = await client.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'user_id'
       AND table_name NOT IN ('plaid_items', 'sessions', 'auth_accounts')
     ORDER BY table_name`,
  );
  userTables = rows.map((r) => r.table_name);
  return userTables;
}

// Every row a person has in the user-owned tables, one query: not their banks, sessions or
// sign-in accounts, which are theirs alone and never written by a sync.
export async function rowsOf(client: PrismaClient, userId: string): Promise<Record<string, Row[]>> {
  const tables = await tablesOf(client);
  const sql = tables
    .map(
      (t) =>
        `SELECT '${t}' AS t, COALESCE(json_agg(x), '[]'::json) AS rows FROM "${t}" x WHERE x.user_id = $1`,
    )
    .join(" UNION ALL ");
  const out = await client.$queryRawUnsafe<{ t: string; rows: Row[] }[]>(sql, userId);
  // In table order: Postgres may run the parts of a UNION ALL in parallel and return them in any
  // order, and a person's fingerprint (a snapshot's key) must not change with it.
  return Object.fromEntries(
    out
      .filter((r) => r.rows.length > 0)
      .sort((a, b) => a.t.localeCompare(b.t))
      .map((r) => [r.t, r.rows]),
  );
}

export const rowOf = async (client: PrismaClient, table: string, id: string) =>
  (
    await client.$queryRawUnsafe<{ r: Row }[]>(
      `SELECT row_to_json(x) AS r FROM "${table}" x WHERE x.id = $1`,
      id,
    )
  )[0]?.r ?? null;

// What a person looks like before the sync, without anything that is only theirs or only now:
// ids, random tokens, the demo seed and the clock's own time are masked, everything else counts.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
function masked(v: unknown): unknown {
  if (typeof v === "string") {
    if (ISO.test(v) && Math.abs(Date.parse(v) - Date.now()) < 2 * 86_400_000) return "<now>";
    // Ids first: a random cuid can hold 16 hex characters in a row, which would otherwise be
    // masked as hex and leave the rest of the id showing ("cmvq<hex>g885q").
    return v.replace(/\bc[a-z0-9]{24}\b/g, "<id>").replace(/[0-9a-f]{16,64}/g, "<hex>");
  }
  if (Array.isArray(v)) return v.map(masked);
  // An object keyed by ids ({ "account:<id>": 399, … }): its masked entries, in a fixed order
  // (Postgres orders a jsonb object's keys by length, so new ids reorder them).
  if (v && typeof v === "object")
    return Object.entries(v)
      .map(([k, x]) => JSON.stringify([masked(k), masked(x)]))
      .sort();
  return v;
}

export function fingerprint(tables: Record<string, Row[]>, user: Row, item: Row): string {
  const strip = (r: Row) =>
    masked(Object.fromEntries(Object.entries(r).filter(([k]) => !IGNORED_COLUMNS.test(k))));
  const view = {
    tables: Object.fromEntries(
      Object.entries(tables).map(([t, rows]) => [
        t,
        rows.map((r) => JSON.stringify(strip(r))).sort(),
      ]),
    ),
    user: strip({ ...user, email: null }),
    item: strip({
      ...item,
      access_token_encrypted: null,
      plaid_item_id: null,
      transactions_cursor: null,
    }),
  };
  return JSON.stringify(view);
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex");

// Values a sync stores that are a hash of rows: rewritten with the rows they hash. A message
// about a finding keeps its fingerprint (src/lib/jane-agent/snapshot.ts) to tell whether the
// finding changed since; a copy's must be the copied finding's.
type Fingerprints = (finding: {
  id: string;
  type: string;
  title: string;
  annualSavingsCents: number | null;
  evidence: unknown;
}) => string;

function rewriter(
  s: Snapshot,
  userId: string,
  itemId: string,
  seed: string,
  fingerprint: Fingerprints,
) {
  const ids = new Map<string, string>([
    [s.userId, userId],
    [s.itemId, itemId],
  ]);
  for (const rows of Object.values(s.tables))
    for (const r of rows)
      if (typeof r.id === "string" && !ids.has(r.id))
        ids.set(
          r.id,
          `c${BigInt(`0x${hash(`${r.id}:${userId}`)}`)
            .toString(36)
            .slice(0, 24)}`,
        );
  const str = (v: string): string => {
    const exact = ids.get(v);
    if (exact) return exact;
    let out = v;
    if (out.includes(s.userId)) out = out.split(s.userId).join(userId);
    if (out.includes(s.itemId)) out = out.split(s.itemId).join(itemId);
    if (out.includes(s.seed)) out = out.split(s.seed).join(seed);
    return out.replace(/\bc[a-z0-9]{24}\b/g, (m) => ids.get(m) ?? m);
  };
  const value = (v: unknown): unknown => {
    if (typeof v === "string") return str(v);
    if (Array.isArray(v)) return v.map(value);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [str(k), value(x)]));
    return v;
  };
  for (const f of s.tables.findings ?? []) {
    const fp = (r: Row) =>
      fingerprint({
        id: String(r.id),
        type: String(r.type),
        title: String(r.title),
        annualSavingsCents: (r.annual_savings_cents as number | null) ?? null,
        evidence: r.evidence,
      });
    ids.set(fp(f), fp(value(f) as Row));
  }
  // Random tokens that must be unique across everyone (a reply token, a link's hash) are the
  // person's own too: same length, new.
  const own = (t: string) => hash(`${t}:${userId}`).repeat(2).slice(0, t.length);
  return (r: Row) => {
    const out = value(r) as Row;
    for (const c of TOKEN_COLUMNS) if (typeof out[c] === "string") out[c] = own(out[c] as string);
    return out;
  };
}

async function restore(
  client: PrismaClient,
  s: Snapshot,
  userId: string,
  itemId: string,
  seed: string,
) {
  const { findingFingerprint } = await import("@/lib/jane-agent/snapshot");
  const rewrite = rewriter(s, userId, itemId, seed, findingFingerprint);
  const tables = await tablesOf(client);
  await client.$transaction(
    async (tx) => {
      // The rows go in as they are, in any order: no foreign-key triggers inside this one.
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      for (const t of tables)
        await tx.$executeRawUnsafe(`DELETE FROM "${t}" WHERE user_id = $1`, userId);
      for (const [t, rows] of Object.entries(s.tables))
        await tx.$executeRawUnsafe(
          `INSERT INTO "${t}" SELECT * FROM json_populate_recordset(NULL::"${t}", $1::json)`,
          JSON.stringify(rows.map(rewrite)),
        );
      const keepItem = new Set([
        "id",
        "user_id",
        "plaid_item_id",
        "access_token_encrypted",
        "created_at",
      ]);
      const itemCols = Object.keys(s.item).filter((k) => !keepItem.has(k));
      if (itemCols.length > 0)
        await tx.$executeRawUnsafe(
          `UPDATE plaid_items SET (${itemCols.map((c) => `"${c}"`).join(", ")}) =
             (SELECT ${itemCols.map((c) => `r."${c}"`).join(", ")} FROM json_populate_record(NULL::plaid_items, $1::json) r)
           WHERE id = $2`,
          JSON.stringify(rewrite(s.item)),
          itemId,
        );
      const userCols = s.userColumns.filter((c) => !["id", "email", "created_at"].includes(c));
      if (userCols.length > 0)
        await tx.$executeRawUnsafe(
          `UPDATE users SET (${userCols.map((c) => `"${c}"`).join(", ")}) =
             (SELECT ${userCols.map((c) => `r."${c}"`).join(", ")} FROM json_populate_record(NULL::users, $1::json) r)
           WHERE id = $2`,
          JSON.stringify(rewrite(s.user)),
          userId,
        );
    },
    { timeout: 120_000 },
  );
}

vi.mock("@/lib/plaid/sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plaid/sync")>();
  const debug = (...a: unknown[]) => {
    if (process.env.SYNC_SNAPSHOTS === "debug") console.log("[sync-snapshots]", ...a);
  };
  const skip = (itemId: string, options: Parameters<typeof actual.syncItem>[1]) => {
    tally.skipped += 1;
    return actual.syncItem(itemId, options);
  };
  const syncItem: typeof actual.syncItem = async (itemId, options = {}) => {
    debug("sync", itemId);
    if (off() || options.progressive || options.onReady) return skip(itemId, options);
    const { db } = await import("@/lib/db");
    const client = (options.client ?? db) as PrismaClient;
    const item = await rowOf(client, "plaid_items", itemId);
    if (!item || item.transactions_cursor) return skip(itemId, options);
    const userId = String(item.user_id);
    const { decrypt } = await import("@/lib/crypto");
    let token: string;
    try {
      token = decrypt(String(item.access_token_encrypted));
    } catch {
      return skip(itemId, options);
    }
    const [prefix, seed, ...rest] = token.split(":");
    if (prefix !== "demo" || !seed) return skip(itemId, options);
    const banks = await client.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM plaid_items WHERE user_id = $1`,
      userId,
    );
    if (banks[0].n !== 1) return skip(itemId, options);
    const user = (await rowOf(client, "users", userId))!;
    const before = await rowsOf(client, userId);
    const key = hash(
      JSON.stringify({
        token: rest.join(":"),
        now: (options.now ?? null)?.toISOString() ?? new Date().toISOString().slice(0, 10),
        today: new Date().toISOString().slice(0, 10),
        trial: userId.startsWith("trial_"),
        before: fingerprint(before, user, item),
        // The encryption key is each file's own (the copy never carries anything it encrypted).
        env: Object.entries(process.env)
          .filter(([k, v]) => !PER_FILE_ENV.test(k) && v !== "" && v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
        mocks: await mocksOfFile(),
        database: process.env.TEST_DATABASE_URL ?? null,
      }),
    );
    let found = await load(key);
    let mine = false;
    if (!found) {
      const claimed = await claim(key);
      if (claimed === "theirs") found = await waitFor(key);
      mine = claimed === "mine";
    }
    const kept = found && (await sharedRowsExist(client, found)) ? found : null;
    debug(kept ? "copy" : "real", key.slice(0, 8));
    if (kept) {
      tally.copied += 1;
      await restore(client, kept, userId, itemId, seed);
      return kept.result;
    }
    const started = Date.now();
    let result: Awaited<ReturnType<typeof actual.syncItem>>;
    try {
      result = await actual.syncItem(itemId, options);
    } catch (error) {
      if (mine) await release(key);
      throw error;
    }
    tally.real += 1;
    tally.ms += Date.now() - started;
    tally.people.push(
      `${rest.join(":") || "demo"}@${options.now?.toISOString().slice(0, 16) ?? "now"}`,
    );
    const after = (await rowOf(client, "users", userId))!;
    await save(key, {
      userId,
      itemId,
      seed,
      tables: await rowsOf(client, userId),
      item: (await rowOf(client, "plaid_items", itemId))!,
      user: after,
      userColumns: Object.keys(after).filter(
        (c) => JSON.stringify(after[c]) !== JSON.stringify(user[c]),
      ),
      result,
    });
    if (mine) await release(key);
    return result;
  };
  return { ...actual, syncItem };
});
