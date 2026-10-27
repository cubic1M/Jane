import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { logAudit, type AuditActor } from "@/lib/audit";
import { BYTES_HEADER_LENGTH, keyIdOf, keyIdOfBytes, rotate, rotateBytes } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { currentKey, keyring } from "@/lib/keyring";

// Key rotation (docs/security/keys.md): moves every encrypted value to the current key, and
// counts values per key so an old key is retired only once nothing uses it.
//
// Safe to stop and run again at any time: each value is saved on its own, values already on
// the current key are skipped, and a save only lands if the value hasn't changed since it
// was read. It reads only key ids (the label on each value), never prints a value, and the
// audit log gets counts only.

// Values whose label can't be read; they need a person to look, and keep no key retired.
export const UNREADABLE = "unreadable";

type Options = {
  client?: PrismaClient;
  // Tests only: limit the job to these people's values (the test database is shared).
  userIds?: string[];
};

type Row = { id: string; keyId: string };

type Store = {
  name: string;
  // The next rows after `after` (by id), with the key id each one is under.
  scan(
    client: PrismaClient,
    after: string | null,
    take: number,
    userIds?: string[],
  ): Promise<Row[]>;
  // Moves one value to the current key. False if it was already there or changed meanwhile.
  rotateOne(client: PrismaClient, id: string): Promise<boolean>;
};

const labelOf = (read: () => string) => {
  try {
    return read();
  } catch {
    return UNREADABLE;
  }
};

const afterId = (after: string | null) => (after ? { id: { gt: after } } : {});

const STORES: Store[] = [
  {
    name: "Bank connections",
    async scan(client, after, take, userIds) {
      const rows = await client.plaidItem.findMany({
        where: { ...afterId(after), ...(userIds && { userId: { in: userIds } }) },
        orderBy: { id: "asc" },
        take,
        select: { id: true, accessTokenEncrypted: true },
      });
      return rows.map((r) => ({ id: r.id, keyId: labelOf(() => keyIdOf(r.accessTokenEncrypted)) }));
    },
    async rotateOne(client, id) {
      const row = await client.plaidItem.findUnique({
        where: { id },
        select: { accessTokenEncrypted: true },
      });
      const next = row && rotate(row.accessTokenEncrypted);
      if (!row || !next) return false;
      const { count } = await client.plaidItem.updateMany({
        where: { id, accessTokenEncrypted: row.accessTokenEncrypted },
        data: { accessTokenEncrypted: next },
      });
      return count === 1;
    },
  },
  {
    name: "Two-factor secrets",
    async scan(client, after, take, userIds) {
      const rows = await client.user.findMany({
        where: {
          id: { ...(after && { gt: after }), ...(userIds && { in: userIds }) },
          mfaSecretEncrypted: { not: null },
        },
        orderBy: { id: "asc" },
        take,
        select: { id: true, mfaSecretEncrypted: true },
      });
      return rows.map((r) => ({
        id: r.id,
        keyId: labelOf(() => keyIdOf(r.mfaSecretEncrypted ?? "")),
      }));
    },
    async rotateOne(client, id) {
      const row = await client.user.findUnique({
        where: { id },
        select: { mfaSecretEncrypted: true },
      });
      const next = row?.mfaSecretEncrypted ? rotate(row.mfaSecretEncrypted) : null;
      if (!row?.mfaSecretEncrypted || !next) return false;
      const { count } = await client.user.updateMany({
        where: { id, mfaSecretEncrypted: row.mfaSecretEncrypted },
        data: { mfaSecretEncrypted: next },
      });
      return count === 1;
    },
  },
  {
    name: "Uploaded files",
    // Only each file's first bytes are read to find its key; files can be megabytes.
    async scan(client, after, take, userIds) {
      const rows = await client.$queryRaw<{ id: string; head: Uint8Array }[]>`
        SELECT id, substring(encrypted_bytes from 1 for ${BYTES_HEADER_LENGTH}) AS head
        FROM documents
        WHERE ${after ? Prisma.sql`id > ${after}` : Prisma.sql`TRUE`}
          AND ${userIds ? Prisma.sql`user_id = ANY(${userIds})` : Prisma.sql`TRUE`}
        ORDER BY id
        LIMIT ${take}`;
      return rows.map((r) => ({ id: r.id, keyId: labelOf(() => keyIdOfBytes(r.head)) }));
    },
    async rotateOne(client, id) {
      const row = await client.document.findUnique({
        where: { id },
        select: { encryptedBytes: true },
      });
      const next = row && rotateBytes(row.encryptedBytes);
      if (!row || !next) return false;
      const { count } = await client.document.updateMany({
        where: { id, encryptedBytes: { equals: row.encryptedBytes } },
        data: { encryptedBytes: next },
      });
      return count === 1;
    },
  },
];

const SCAN_BATCH = 200;

export type KeyReport = {
  // The key new values are written with.
  current: string;
  // Configured keys with how many values each one encrypts.
  keys: { id: string; values: number; current: boolean; retirable: boolean }[];
  // Values whose key isn't configured (they can't be read until it's added back), and
  // values whose label can't be read.
  missing: { id: string; values: number }[];
  // Counts by place and key id.
  stores: { name: string; byKey: Record<string, number> }[];
  // What's wrong with the env vars, by variable or key name.
  problems: string[];
};

export async function keyReport({
  client = defaultClient,
  userIds,
}: Options = {}): Promise<KeyReport> {
  const ring = keyring();
  const totals = new Map<string, number>();
  const stores: KeyReport["stores"] = [];
  for (const store of STORES) {
    const byKey: Record<string, number> = {};
    for (let after: string | null = null; ;) {
      const rows = await store.scan(client, after, SCAN_BATCH, userIds);
      for (const { keyId } of rows) {
        byKey[keyId] = (byKey[keyId] ?? 0) + 1;
        totals.set(keyId, (totals.get(keyId) ?? 0) + 1);
      }
      if (rows.length < SCAN_BATCH) break;
      after = rows[rows.length - 1].id;
    }
    stores.push({ name: store.name, byKey });
  }

  const keys = [...ring.keys.keys()].map((id) => {
    const values = totals.get(id) ?? 0;
    const current = id === ring.current;
    return { id, values, current, retirable: !current && values === 0 };
  });
  const missing = [...totals]
    .filter(([id]) => !ring.keys.has(id))
    .map(([id, values]) => ({ id, values }));
  return { current: ring.current, keys, missing, stores, problems: ring.problems };
}

export type RotationResult = {
  target: string;
  rotated: number;
  // Values that couldn't be moved (their key is missing or wrong); they stay as they were.
  failed: number;
  // False when the time ran out first; run again to carry on.
  done: boolean;
};

// Moves values to the current key, in batches, until done or `deadline` (a time budget so a
// web request finishes; run again to continue).
export async function runRotation({
  client = defaultClient,
  userIds,
  deadline = Number.POSITIVE_INFINITY,
  now = () => Date.now(),
  batchSize = 50,
}: Options & {
  deadline?: number;
  now?: () => number;
  batchSize?: number;
} = {}): Promise<RotationResult> {
  // Stops here, before touching anything, if the current key isn't usable.
  const target = currentKey().id;
  const result: RotationResult = { target, rotated: 0, failed: 0, done: false };
  for (const store of STORES) {
    for (let after: string | null = null; ;) {
      if (now() >= deadline) return result;
      const rows = await store.scan(client, after, batchSize, userIds);
      for (const row of rows) {
        if (row.keyId === target) continue;
        if (now() >= deadline) return result;
        try {
          if (await store.rotateOne(client, row.id)) result.rotated += 1;
        } catch {
          // The error isn't kept: it could describe the value. The report shows which key
          // the value needs.
          result.failed += 1;
        }
      }
      if (rows.length < batchSize) break;
      after = rows[rows.length - 1].id;
    }
  }
  result.done = true;
  return result;
}

// The admin button: one run within the time budget, written to the audit log (counts only).
export async function rotateKeys(
  actor: AuditActor,
  options: Options & { deadline?: number } = {},
): Promise<RotationResult> {
  const result = await runRotation(options);
  await logAudit(actor, "encryption_keys_rotated", null, {
    target: result.target,
    rotated: result.rotated,
    failed: result.failed,
    done: result.done,
  });
  return result;
}
