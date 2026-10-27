import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { logAudit } from "@/lib/audit";
import { decrypt, decryptBytes, encrypt, encryptBytes, keyIdOf } from "@/lib/crypto";
import { UNREADABLE, keyReport, rotateKeys, runRotation } from "./key-rotation";

// Key rotation against a real, migrated Postgres (docs/security/keys.md): every stored
// value moves to the current key, in batches, safe to stop and run again.

const url = process.env.TEST_DATABASE_URL;

const LEGACY = randomBytes(32).toString("base64");
const K2 = randomBytes(32).toString("base64");
const K9 = randomBytes(32).toString("base64");

function useKeys(env: { legacy?: string; keys?: string; current?: string }) {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", env.legacy ?? "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEYS", env.keys ?? "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", env.current ?? "");
}
const ONLY_LEGACY = { legacy: LEGACY };
const ROTATED = { legacy: LEGACY, keys: `k2:${K2}`, current: "k2" };

describe.runIf(url)("key rotation", () => {
  let client: PrismaClient;
  const userIds: string[] = [];
  const file = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(2000)]);

  async function person(withMfa: boolean) {
    const user = await client.user.create({
      data: {
        email: `keys-${crypto.randomUUID()}@example.com`,
        ...(withMfa && { mfaSecretEncrypted: encrypt("JBSWY3DPEHPK3PXP") }),
      },
    });
    userIds.push(user.id);
    return user.id;
  }
  const bank = (userId: string, token: string, encrypted = encrypt(token)) =>
    client.plaidItem.create({
      data: { userId, plaidItemId: `item-${crypto.randomUUID()}`, accessTokenEncrypted: encrypted },
    });
  const upload = (userId: string) =>
    client.document.create({
      data: {
        userId,
        kind: "receipt",
        fileName: "receipt.pdf",
        contentType: "application/pdf",
        sizeBytes: file.length,
        encryptedBytes: encryptBytes(file),
      },
    });
  const total = (report: Awaited<ReturnType<typeof keyReport>>, id: string) =>
    report.stores.reduce((sum, s) => sum + (s.byKey[id] ?? 0), 0);

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterEach(async () => {
    await client.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    vi.unstubAllEnvs();
  });
  afterAll(() => client.$disconnect());

  it("moves every value to the new key in batches, resumes, and lets the old key go", async () => {
    useKeys(ONLY_LEGACY);
    const alice = await person(true);
    const bob = await person(false);
    for (const n of [1, 2, 3]) await bank(alice, `access-old-${n}`);
    await upload(bob);
    useKeys(ROTATED);
    await bank(bob, "access-new");

    const before = await keyReport({ client, userIds });
    expect(before.current).toBe("k2");
    expect(total(before, "legacy")).toBe(5);
    expect(total(before, "k2")).toBe(1);
    expect(before.keys).toEqual([
      { id: "legacy", values: 5, current: false, retirable: false },
      { id: "k2", values: 1, current: true, retirable: false },
    ]);

    // A time budget that runs out partway: progress is kept, and the next run carries on.
    let clock = 0;
    const first = await runRotation({
      client,
      userIds,
      batchSize: 2,
      now: () => clock++,
      deadline: 4,
    });
    expect(first.done).toBe(false);
    expect(first.rotated).toBeGreaterThan(0);
    const second = await runRotation({ client, userIds, batchSize: 2 });
    expect(second).toMatchObject({ target: "k2", failed: 0, done: true });
    expect(first.rotated + second.rotated).toBe(5);

    // Running again changes nothing.
    expect(await runRotation({ client, userIds })).toEqual({
      target: "k2",
      rotated: 0,
      failed: 0,
      done: true,
    });

    const after = await keyReport({ client, userIds });
    expect(total(after, "k2")).toBe(6);
    expect(after.keys[0]).toEqual({ id: "legacy", values: 0, current: false, retirable: true });

    // With the original key removed, everything still reads.
    useKeys({ keys: `k2:${K2}`, current: "k2" });
    const items = await client.plaidItem.findMany({
      where: { userId: { in: userIds } },
      orderBy: { plaidItemId: "asc" },
    });
    expect(items.map((i) => keyIdOf(i.accessTokenEncrypted))).toEqual(Array(4).fill("k2"));
    expect(items.map((i) => decrypt(i.accessTokenEncrypted)).sort()).toEqual([
      "access-new",
      "access-old-1",
      "access-old-2",
      "access-old-3",
    ]);
    const user = await client.user.findUniqueOrThrow({ where: { id: alice } });
    expect(decrypt(user.mfaSecretEncrypted!)).toBe("JBSWY3DPEHPK3PXP");
    const doc = await client.document.findFirstOrThrow({ where: { userId: bob } });
    expect(decryptBytes(doc.encryptedBytes).equals(file)).toBe(true);
  });

  it("skips values it can't read, leaves them as they were, and reports them", async () => {
    useKeys({ legacy: LEGACY, keys: `k9:${K9}`, current: "k9" });
    const userId = await person(false);
    const lost = await bank(userId, "access-lost");
    const garbled = await bank(userId, "", "not-an-encrypted-value");
    useKeys(ROTATED);
    await bank(userId, "access-fine");

    const result = await runRotation({ client, userIds });
    expect(result).toMatchObject({ rotated: 0, failed: 2, done: true });
    const unchanged = await client.plaidItem.findUniqueOrThrow({ where: { id: lost.id } });
    expect(unchanged.accessTokenEncrypted).toBe(lost.accessTokenEncrypted);
    expect(
      (await client.plaidItem.findUniqueOrThrow({ where: { id: garbled.id } }))
        .accessTokenEncrypted,
    ).toBe("not-an-encrypted-value");

    const report = await keyReport({ client, userIds });
    expect(report.missing.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "k9", values: 1 },
      { id: UNREADABLE, values: 1 },
    ]);
  });

  it("changes nothing when the current key isn't usable", async () => {
    useKeys(ONLY_LEGACY);
    const userId = await person(false);
    const item = await bank(userId, "access-1");
    useKeys({ legacy: LEGACY, keys: "k2:short", current: "k2" });

    await expect(runRotation({ client, userIds })).rejects.toThrow(
      'TOKEN_ENCRYPTION_KEY_CURRENT is "k2"',
    );
    const report = await keyReport({ client, userIds });
    expect(report.problems).toContain('Key "k2" must be 32 bytes, base64-encoded');
    expect(
      (await client.plaidItem.findUniqueOrThrow({ where: { id: item.id } })).accessTokenEncrypted,
    ).toBe(item.accessTokenEncrypted);
  });

  it("writes each run to the audit log, counts only", async () => {
    useKeys(ONLY_LEGACY);
    const userId = await person(true);
    await bank(userId, "access-1");
    useKeys(ROTATED);

    const result = await rotateKeys({ type: "admin", id: "admin_1" }, { client, userIds });
    expect(result).toMatchObject({ rotated: 2, failed: 0, done: true });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "encryption_keys_rotated",
      null,
      { target: "k2", rotated: 2, failed: 0, done: true },
    );
  });
});
