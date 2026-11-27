import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { logAudit, type AuditActor } from "@/lib/audit";
import { BYTES_HEADER_LENGTH, keyIdOf, keyIdOfBytes, rotate, rotateBytes } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { alertError } from "@/lib/error-alerts";
import { RotationNotRecordedError, type Checkpoint } from "@/lib/key-checkpoint";
import { currentKey, keyring } from "@/lib/keyring";
import { log } from "@/lib/log";
import { systemDb } from "@/lib/system-db";

const WHY = "Key rotation re-encrypts everyone's secrets";

// Key rotation (docs/security/keys.md): moves every encrypted value to the current key, and
// counts values per key so an old key is retired only once nothing uses it.
//
// Safe to stop and run again at any time: each value is saved on its own, values already on
// the current key are skipped, and a save only lands if the value hasn't changed since it
// was read. A run out of time says where it got to, and the next one carries on there, so a
// large table early on can't keep the ones after it out of reach. It reads only key ids (the label on each value), never prints a value, and the
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
      const rows = await systemDb(WHY, client).plaidItem.findMany({
        where: { ...afterId(after), ...(userIds && { userId: { in: userIds } }) },
        orderBy: { id: "asc" },
        take,
        select: { id: true, accessTokenEncrypted: true },
      });
      return rows.map((r) => ({ id: r.id, keyId: labelOf(() => keyIdOf(r.accessTokenEncrypted)) }));
    },
    async rotateOne(client, id) {
      const row = await systemDb(WHY, client).plaidItem.findUnique({
        where: { id },
        select: { accessTokenEncrypted: true },
      });
      const next = row && rotate(row.accessTokenEncrypted);
      if (!row || !next) return false;
      const { count } = await systemDb(WHY, client).plaidItem.updateMany({
        where: { id, accessTokenEncrypted: row.accessTokenEncrypted },
        data: { accessTokenEncrypted: next },
      });
      return count === 1;
    },
  },
  {
    name: "Robinhood connections",
    async scan(client, after, take, userIds) {
      const rows = await systemDb(WHY, client).robinhoodConnection.findMany({
        where: { ...afterId(after), ...(userIds && { userId: { in: userIds } }) },
        orderBy: { id: "asc" },
        take,
        select: { id: true, secretsEncrypted: true },
      });
      return rows.map((r) => ({ id: r.id, keyId: labelOf(() => keyIdOf(r.secretsEncrypted)) }));
    },
    async rotateOne(client, id) {
      const row = await systemDb(WHY, client).robinhoodConnection.findUnique({
        where: { id },
        select: { secretsEncrypted: true },
      });
      const next = row && rotate(row.secretsEncrypted);
      if (!row || !next) return false;
      const { count } = await systemDb(WHY, client).robinhoodConnection.updateMany({
        where: { id, secretsEncrypted: row.secretsEncrypted },
        data: { secretsEncrypted: next },
      });
      return count === 1;
    },
  },
  {
    name: "Connector credentials",
    async scan(client, after, take, userIds) {
      const rows = await systemDb(WHY, client).connectorCredential.findMany({
        where: { ...afterId(after), ...(userIds && { userId: { in: userIds } }) },
        orderBy: { id: "asc" },
        take,
        select: { id: true, secretEncrypted: true },
      });
      return rows.map((r) => ({ id: r.id, keyId: labelOf(() => keyIdOf(r.secretEncrypted)) }));
    },
    async rotateOne(client, id) {
      const row = await systemDb(WHY, client).connectorCredential.findUnique({
        where: { id },
        select: { secretEncrypted: true },
      });
      const next = row && rotate(row.secretEncrypted);
      if (!row || !next) return false;
      const { count } = await systemDb(WHY, client).connectorCredential.updateMany({
        where: { id, secretEncrypted: row.secretEncrypted },
        data: { secretEncrypted: next },
      });
      return count === 1;
    },
  },
  {
    name: "Two-factor secrets",
    async scan(client, after, take, userIds) {
      const rows = await systemDb(WHY, client).user.findMany({
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
      const row = await systemDb(WHY, client).user.findUnique({
        where: { id },
        select: { mfaSecretEncrypted: true },
      });
      const next = row?.mfaSecretEncrypted ? rotate(row.mfaSecretEncrypted) : null;
      if (!row?.mfaSecretEncrypted || !next) return false;
      const { count } = await systemDb(WHY, client).user.updateMany({
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
      const rows = await systemDb(WHY, client).$queryRaw<{ id: string; head: Uint8Array }[]>`
        SELECT id, substring(encrypted_bytes from 1 for ${BYTES_HEADER_LENGTH}) AS head
        FROM documents
        WHERE ${after ? Prisma.sql`id > ${after}` : Prisma.sql`TRUE`}
          AND ${userIds ? Prisma.sql`user_id = ANY(${userIds})` : Prisma.sql`TRUE`}
        ORDER BY id
        LIMIT ${take}`;
      return rows.map((r) => ({ id: r.id, keyId: labelOf(() => keyIdOfBytes(r.head)) }));
    },
    async rotateOne(client, id) {
      const row = await systemDb(WHY, client).document.findUnique({
        where: { id },
        select: { encryptedBytes: true },
      });
      const next = row && rotateBytes(row.encryptedBytes);
      if (!row || !next) return false;
      const { count } = await systemDb(WHY, client).document.updateMany({
        where: { id, encryptedBytes: { equals: row.encryptedBytes } },
        data: { encryptedBytes: next },
      });
      return count === 1;
    },
  },
  {
    name: "Feedback screenshots",
    async scan(client, after, take, userIds) {
      const rows = await systemDb(WHY, client).$queryRaw<{ id: string; head: Uint8Array }[]>`
        SELECT id, substring(screenshot_encrypted from 1 for ${BYTES_HEADER_LENGTH}) AS head
        FROM problem_reports
        WHERE screenshot_encrypted IS NOT NULL
          AND ${after ? Prisma.sql`id > ${after}` : Prisma.sql`TRUE`}
          AND ${userIds ? Prisma.sql`user_id = ANY(${userIds})` : Prisma.sql`TRUE`}
        ORDER BY id
        LIMIT ${take}`;
      return rows.map((r) => ({ id: r.id, keyId: labelOf(() => keyIdOfBytes(r.head)) }));
    },
    async rotateOne(client, id) {
      const row = await systemDb(WHY, client).problemReport.findUnique({
        where: { id },
        select: { screenshotEncrypted: true },
      });
      const next = row?.screenshotEncrypted ? rotateBytes(row.screenshotEncrypted) : null;
      if (!row?.screenshotEncrypted || !next) return false;
      const { count } = await systemDb(WHY, client).problemReport.updateMany({
        where: { id, screenshotEncrypted: { equals: row.screenshotEncrypted } },
        data: { screenshotEncrypted: next },
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
    // A value whose key can't be told may be this one's: no key is safe to remove until it's read.
    const retirable = !current && values === 0 && !totals.has(UNREADABLE);
    return { id, values, current, retirable };
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
  // Where it got to, when it isn't done.
  next?: Checkpoint;
};

// Moves values to the current key, in batches, until done or `deadline` (a time budget so a
// web request finishes; run again to continue).
export async function runRotation({
  client = defaultClient,
  userIds,
  deadline = Number.POSITIVE_INFINITY,
  now = () => Date.now(),
  batchSize = 50,
  from,
}: Options & {
  deadline?: number;
  now?: () => number;
  batchSize?: number;
  from?: Checkpoint;
} = {}): Promise<RotationResult> {
  // Stops here, before touching anything, if the current key isn't usable.
  const target = currentKey().id;
  const result: RotationResult = { target, rotated: 0, failed: 0, done: false };
  // A checkpoint for another key, or for no store here, starts at the beginning.
  const resumed = from?.target === target ? STORES.findIndex((s) => s.name === from.store) : -1;
  for (let index = Math.max(0, resumed); index < STORES.length; index += 1) {
    const store = STORES[index]!;
    let after: string | null = index === resumed ? from!.after : null;
    const stopped = () => ({ ...result, next: { target, store: store.name, after } });
    for (;;) {
      if (now() >= deadline) return stopped();
      const rows = await store.scan(client, after, batchSize, userIds);
      for (const row of rows) {
        if (row.keyId !== target) {
          if (now() >= deadline) return stopped();
          try {
            if (await store.rotateOne(client, row.id)) result.rotated += 1;
          } catch {
            // The error isn't kept: it could describe the value. The report shows which key
            // the value needs.
            result.failed += 1;
          }
        }
        after = row.id;
      }
      if (rows.length < batchSize) break;
    }
  }
  result.done = true;
  return result;
}

// The admin button: one run within the time budget, written to the audit log (counts only).
// That it started is written first, and nothing moves unless that is saved; if the record of how
// it ended can't be, the team is told and the run's counts still reach the page and the log.
export async function rotateKeys(
  actor: AuditActor,
  options: Options & { deadline?: number; from?: Checkpoint } = {},
): Promise<RotationResult> {
  const target = currentKey().id;
  try {
    await logAudit(actor, "encryption_keys_rotation_started", null, { target });
  } catch {
    throw new RotationNotRecordedError("The rotation couldn't be put on record");
  }
  const result = await runRotation(options);
  const counts = {
    target: result.target,
    rotated: result.rotated,
    failed: result.failed,
    done: result.done,
  };
  try {
    await logAudit(actor, "encryption_keys_rotated", null, counts);
  } catch (error) {
    log.error("A key rotation's record wasn't written", {
      ...counts,
      error: error instanceof Error ? error.name : "Error",
    });
    await alertError(
      {
        message: "RotationNotRecorded: a key rotation ran and its record wasn't written",
        path: "/admin/keys",
      },
      { pastCeiling: true },
    );
  }
  return result;
}
