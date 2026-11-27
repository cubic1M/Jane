import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// A rotation too big for one press carries on where it stopped, and is on record before it moves
// anything.

const { logAudit, alertError } = vi.hoisted(() => ({
  logAudit: vi.fn(async () => undefined),
  alertError: vi.fn(async () => true),
}));
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("@/lib/error-alerts", () => ({ alertError }));

import { encrypt, keyIdOf } from "@/lib/crypto";
import { rotateKeys, runRotation, type RotationResult } from "@/lib/key-rotation";

const url = process.env.TEST_DATABASE_URL;
const LEGACY = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");

describe.runIf(url)("a rotation over several presses", () => {
  let client: PrismaClient;
  const userIds: string[] = [];
  const actor = { type: "admin", id: "admin_resume" } as const;

  function setKeys(current: "legacy" | "k2") {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", LEGACY);
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", `k2:${K2}`);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", current === "k2" ? "k2" : "");
  }
  // Several bank connections already on the new key, ahead of one two-factor secret on the old one.
  async function backlog() {
    setKeys("legacy");
    const user = await client.user.create({
      data: {
        email: `resume-${crypto.randomUUID()}@example.com`,
        mfaSecretEncrypted: encrypt("JBSWY3DPEHPK3PXP"),
      },
    });
    userIds.push(user.id);
    setKeys("k2");
    for (const n of [1, 2, 3, 4]) {
      await client.plaidItem.create({
        data: {
          userId: user.id,
          plaidItemId: `item-${crypto.randomUUID()}`,
          accessTokenEncrypted: encrypt(`access-${n}`),
        },
      });
    }
    return user.id;
  }
  // One press: time for two steps.
  const press = (from?: RotationResult["next"]) => {
    let clock = 0;
    return runRotation({ client, userIds, batchSize: 1, now: () => clock++, deadline: 2, from });
  };
  const secretKey = async (userId: string) =>
    keyIdOf((await client.user.findUniqueOrThrow({ where: { id: userId } })).mfaSecretEncrypted!);

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterEach(async () => {
    await client.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });
  afterAll(() => client.$disconnect());

  it("reaches a later place when each press has time for only a little", async () => {
    const userId = await backlog();
    let result = await press();
    let presses = 1;
    while (!result.done && presses < 20) {
      result = await press(result.next);
      presses += 1;
    }
    expect(result.done).toBe(true);
    expect(result.next).toBeUndefined();
    expect(await secretKey(userId)).toBe("k2");
  });

  it("starts from the beginning for a checkpoint made for another key", async () => {
    const userId = await backlog();
    const result = await runRotation({
      client,
      userIds,
      from: { target: "k1", store: "Feedback screenshots", after: null },
    });
    expect(result).toMatchObject({ rotated: 1, done: true });
    expect(await secretKey(userId)).toBe("k2");
  });

  it("writes that it started before it moves anything, and moves nothing if it can't", async () => {
    const userId = await backlog();
    logAudit.mockRejectedValueOnce(new Error("database is away"));
    await expect(rotateKeys(actor, { client, userIds })).rejects.toThrow();
    expect(await secretKey(userId)).toBe("legacy");

    await rotateKeys(actor, { client, userIds });
    expect(logAudit.mock.calls.slice(1).map((call) => (call as unknown[])[1])).toEqual([
      "encryption_keys_rotation_started",
      "encryption_keys_rotated",
    ]);
  });

  it("tells the team when the finished run can't be written, and still answers", async () => {
    const userId = await backlog();
    vi.spyOn(console, "error").mockImplementation(() => {});
    logAudit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("database is away"));

    expect(await rotateKeys(actor, { client, userIds })).toMatchObject({ rotated: 1, done: true });

    expect(await secretKey(userId)).toBe("k2");
    expect(alertError).toHaveBeenCalledWith(
      {
        message: "RotationNotRecorded: a key rotation ran and its record wasn't written",
        path: "/admin/keys",
      },
      { pastCeiling: true },
    );
  });
});
