import { randomBytes } from "node:crypto";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Leak check for key rotation (docs/security/keys.md): with a keyring of named keys, a bank is
// linked and signed in again through the real routes, everything is re-encrypted and
// reported on, and wrong or missing keys fail. Nothing printed, answered, audited or thrown
// contains a token, a two-factor secret or any key, in any encoding.
// src/lib/plaid/token-leak.integration.test.ts does the same for the token's whole life.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () => (session.userId ? { id: session.userId } : null)),
  requireUser: vi.fn(async () => ({ id: session.userId })),
}));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
const tracked = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/analytics", () => ({
  track: vi.fn(async (...args: unknown[]) => tracked.push(args)),
}));
const plaidApi = vi.hoisted(() => ({
  itemPublicTokenExchange: vi.fn(),
  linkTokenCreate: vi.fn(),
  transactionsSync: vi.fn(),
}));
vi.mock("@/lib/plaid/client", async (actual) => ({
  ...(await actual<typeof import("@/lib/plaid/client")>()),
  plaid: () => plaidApi as unknown as PlaidApi,
}));
const pending = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (actual) => ({
  ...(await actual<typeof import("next/server")>()),
  after: (task: Promise<unknown> | (() => unknown)) =>
    pending.push(Promise.resolve(typeof task === "function" ? task() : task)),
}));

import { POST as exchange } from "@/app/api/plaid/exchange/route";
import { POST as linkToken } from "@/app/api/plaid/link-token/route";
import { decrypt, encrypt, keyIdOf } from "@/lib/crypto";
import { db } from "@/lib/db";
import { keyReport, rotateKeys } from "@/lib/key-rotation";
import { keyring } from "@/lib/keyring";

const url = process.env.TEST_DATABASE_URL;
const TOKEN = `access-production-KEYLEAK-${crypto.randomUUID()}`;
const OLD_TOKEN = `access-production-OLDKEYLEAK-${crypto.randomUUID()}`;
const MFA_SECRET = "KEYLEAKMFASECRETABCDEFGH";
const KEYS = { legacy: randomBytes(32), k2: randomBytes(32), k3: randomBytes(32) };
const b64 = (key: Buffer) => key.toString("base64");

// Every way a key or secret could show up in text.
const SECRETS = [
  TOKEN,
  OLD_TOKEN,
  MFA_SECRET,
  ...Object.values(KEYS).flatMap((key) => [
    b64(key),
    key.toString("base64url"),
    key.toString("hex"),
    // A key cut short still gives it away.
    b64(key).slice(0, 24),
  ]),
];

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe.runIf(url)("keys and tokens never leave the server", () => {
  const said: string[] = [];
  const answered: string[] = [];
  let userId: string;

  async function answer(response: Response) {
    const text = await response.text();
    answered.push(`${response.status} ${text}`);
    await Promise.allSettled(pending.splice(0));
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  const failure = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      said.push(String(error), (error as Error).stack ?? "", JSON.stringify(error));
      return;
    }
    throw new Error("expected a failure");
  };

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", b64(KEYS.legacy));
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
    vi.stubEnv("PLAID_CLIENT_ID", "client-test");
    vi.stubEnv("PLAID_SECRET", "secret-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    // Made under the original key, before rotation.
    userId = (
      await db.user.create({
        data: {
          email: `key-leak-${crypto.randomUUID()}@example.com`,
          mfaSecretEncrypted: encrypt(MFA_SECRET),
          plaidItems: {
            create: {
              plaidItemId: `item-old-${crypto.randomUUID()}`,
              accessTokenEncrypted: encrypt(OLD_TOKEN),
            },
          },
        },
      })
    ).id;
    session.userId = userId;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: userId } });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("links, rotates, reports and fails without saying a key or a token anywhere", async () => {
    for (const level of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        said.push(
          args
            .map((a) => (typeof a === "string" ? a : `${JSON.stringify(a)} ${String(a)}`))
            .join(" "),
        );
      });
    for (const stream of [process.stdout, process.stderr])
      vi.spyOn(stream, "write").mockImplementation((chunk: unknown) => {
        said.push(String(chunk));
        return true;
      });

    // The founder adds k2 and k3, with k3 current.
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", `k2:${b64(KEYS.k2)},k3:${b64(KEYS.k3)}`);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "k3");
    plaidApi.itemPublicTokenExchange.mockResolvedValue({
      data: { access_token: TOKEN, item_id: `item-new-${crypto.randomUUID()}`, request_id: "r" },
    });
    plaidApi.linkTokenCreate.mockResolvedValue({ data: { link_token: "link-sandbox-abc" } });
    plaidApi.transactionsSync.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 400"), {
        config: { data: JSON.stringify({ access_token: TOKEN }) },
        response: { status: 400, data: { error_code: "ITEM_LOGIN_REQUIRED", access_token: TOKEN } },
      }),
    );

    const linked = await answer(
      await exchange(post("/api/plaid/exchange", { publicToken: "public-sandbox-x" })),
    );
    expect(linked.status).toBe(201);
    const fresh = await db.plaidItem.findUniqueOrThrow({ where: { id: linked.body.itemId } });
    expect(keyIdOf(fresh.accessTokenEncrypted)).toBe("k3");
    // Update mode decrypts the new value to hand it to Plaid; only a link token comes back.
    const update = await answer(
      await linkToken(post("/api/plaid/link-token", { itemId: fresh.id })),
    );
    expect(update.body).toEqual({ linkToken: "link-sandbox-abc" });

    const before = await keyReport({ userIds: [userId] });
    const rotated = await rotateKeys({ type: "admin", id: userId }, { userIds: [userId] });
    expect(rotated).toMatchObject({ rotated: 2, failed: 0, done: true });
    const after = await keyReport({ userIds: [userId] });
    expect(after.keys.find((k) => k.id === "legacy")).toMatchObject({ values: 0, retirable: true });
    answered.push(JSON.stringify([before, rotated, after]));

    // Wrong, missing and broken keys fail, and the failure doesn't carry the key.
    const value = fresh.accessTokenEncrypted;
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", `k3:${b64(KEYS.k2)}`);
    failure(() => decrypt(value));
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", `k2:${b64(KEYS.k2)}`);
    failure(() => decrypt(value));
    failure(() => encrypt(TOKEN));
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", `k3:${b64(KEYS.k3).slice(0, 30)}`);
    failure(() => encrypt(TOKEN));
    said.push(...keyring().problems);
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", `k3:${b64(KEYS.k3)}`);
    expect(decrypt(value)).toBe(TOKEN);

    const audit = await db.auditLog.findMany({
      where: { OR: [{ actorId: userId }, { targetId: fresh.id }] },
    });
    expect(audit.map((a) => a.event)).toEqual(
      expect.arrayContaining(["item_linked", "encryption_keys_rotated"]),
    );
    const stored = await db.plaidItem.findMany({ where: { userId } });
    const everything = [
      ...said,
      ...answered,
      JSON.stringify(audit),
      JSON.stringify(tracked),
      // The stored values carry key names, never keys.
      ...stored.map((s) => s.accessTokenEncrypted),
    ];
    expect(said.length).toBeGreaterThan(0);
    for (const text of everything) {
      for (const secret of SECRETS) expect(text).not.toContain(secret);
    }
  });
});
