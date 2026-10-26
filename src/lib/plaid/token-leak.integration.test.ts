import { createDecipheriv, randomBytes } from "node:crypto";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Plaid access tokens never leave the server (CLAUDE.md): a bank is linked, signed in again,
// told about by webhook, synced through failures and removed through the real routes, with a
// recognisable stand-in token, and nothing printed or answered contains it. Plaid's SDK errors
// carry the request (token in the body, our secret in the headers), so the failures here do too.
// At rest the token is AES-256-GCM. Plaid itself is a stand-in: no sandbox or live keys.

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
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/plaid/webhook-verify", () => ({ verifyPlaidWebhook: vi.fn(async () => true) }));
const plaidApi = vi.hoisted(() => ({
  itemPublicTokenExchange: vi.fn(),
  linkTokenCreate: vi.fn(),
  transactionsSync: vi.fn(),
  itemRemove: vi.fn(),
}));
vi.mock("@/lib/plaid/client", async (actual) => ({
  ...(await actual<typeof import("@/lib/plaid/client")>()),
  plaid: () => plaidApi as unknown as PlaidApi,
}));
// after() runs straight away, and the test waits for it.
const pending = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (actual) => ({
  ...(await actual<typeof import("next/server")>()),
  after: (task: Promise<unknown> | (() => unknown)) =>
    pending.push(Promise.resolve(typeof task === "function" ? task() : task)),
}));

import { db } from "@/lib/db";
import { POST as exchange } from "@/app/api/plaid/exchange/route";
import { POST as linkToken } from "@/app/api/plaid/link-token/route";
import { POST as repaired } from "@/app/api/plaid/repaired/route";
import { POST as webhook } from "@/app/api/plaid/webhook/route";
import { removePlaidItem } from "./remove";
import { syncItem } from "./sync";

const url = process.env.TEST_DATABASE_URL;
const TOKEN = `access-sandbox-LEAKCHECK-${crypto.randomUUID()}`;
const SECRET = "secret-LEAKCHECK";
const KEY = randomBytes(32);

// A failed call as Plaid's SDK (axios) throws it: the request rides along.
function sdkError(code: string | null, status: number | null) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    code: status ? undefined : "ECONNRESET",
    config: {
      headers: { "PLAID-SECRET": SECRET },
      data: JSON.stringify({ access_token: TOKEN }),
    },
    request: { body: { access_token: TOKEN } },
    response: status ? { status, data: { error_code: code, access_token: TOKEN } } : undefined,
  });
}

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe.runIf(url)("Plaid access tokens never leave the server", () => {
  const said: string[] = [];
  const answered: string[] = [];
  const itemPlaidId = `item-leak-${crypto.randomUUID()}`;
  let userId: string;

  async function answer(response: Response) {
    const text = await response.text();
    answered.push(`${response.status} ${text}`);
    await Promise.allSettled(pending.splice(0));
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY.toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "client-test");
    vi.stubEnv("PLAID_SECRET", SECRET);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    userId = (await db.user.create({ data: { email: `leak-${crypto.randomUUID()}@example.com` } }))
      .id;
    session.userId = userId;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: userId } });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("links, signs in again, syncs through failures and removes, saying the token nowhere", async () => {
    for (const level of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        said.push(
          args
            .map((a) => (typeof a === "string" ? a : `${JSON.stringify(a)} ${String(a)}`))
            .join(" "),
        );
      });
    plaidApi.itemPublicTokenExchange.mockResolvedValue({
      data: { access_token: TOKEN, item_id: itemPlaidId, request_id: "r" },
    });
    plaidApi.linkTokenCreate.mockResolvedValue({ data: { link_token: "link-sandbox-abc" } });
    // The first sync, the webhook's and the one after update mode each fail, each differently.
    plaidApi.transactionsSync
      .mockRejectedValueOnce(sdkError("ITEM_LOGIN_REQUIRED", 400))
      .mockRejectedValueOnce(sdkError("INVALID_REQUEST", 400))
      .mockRejectedValueOnce(sdkError(null, null))
      .mockRejectedValue(sdkError("INVALID_FIELD", 400));
    plaidApi.itemRemove.mockRejectedValueOnce(sdkError("INTERNAL_SERVER_ERROR", 500));

    const linked = await answer(
      await exchange(post("/api/plaid/exchange", { publicToken: "public-sandbox-x" })),
    );
    expect(linked.status).toBe(201);
    const { id: itemId, accessTokenEncrypted } = await db.plaidItem.findFirstOrThrow({
      where: { userId },
    });
    expect((await db.plaidItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe(
      "login_required",
    );

    // Link's update mode is the one place the token goes to Plaid; it comes back as a link token.
    const update = await answer(await linkToken(post("/api/plaid/link-token", { itemId })));
    expect(update.body).toEqual({ linkToken: "link-sandbox-abc" });
    expect(plaidApi.linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: TOKEN }),
    );
    await answer(await repaired(post("/api/plaid/repaired", { itemId })));
    await answer(
      await webhook(
        post("/api/plaid/webhook", {
          webhook_type: "TRANSACTIONS",
          webhook_code: "SYNC_UPDATES_AVAILABLE",
          item_id: itemPlaidId,
        }),
      ),
    );
    await syncItem(itemId).catch((error) => said.push(String(error), JSON.stringify(error)));
    // Plaid can't remove it: the error that comes back is safe to show and to log.
    const failed = await removePlaidItem(userId, itemId, "user_disconnected").catch((e) => e);
    said.push(String(failed), JSON.stringify(failed), (failed as Error).stack ?? "");
    plaidApi.itemRemove.mockResolvedValueOnce({ data: { request_id: "r" } });
    await removePlaidItem(userId, itemId, "user_disconnected");
    expect(await db.plaidItem.count({ where: { userId } })).toBe(0);

    // Every route answered and something was logged, and none of it has the token or secret.
    expect(answered).toHaveLength(4);
    expect(said.length).toBeGreaterThan(0);
    for (const text of [...said, ...answered]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(SECRET);
    }
    // The audit trail neither.
    const audit = await db.auditLog.findMany({ where: { targetId: itemId } });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(TOKEN);

    // At rest: "v1.<iv>.<tag>.<ciphertext>", and AES-256-GCM with the key opens it.
    expect(accessTokenEncrypted).not.toContain(TOKEN);
    const [version, iv, tag, body] = accessTokenEncrypted.split(".");
    expect(version).toBe("v1");
    expect(Buffer.from(iv, "base64url")).toHaveLength(12);
    expect(Buffer.from(tag, "base64url")).toHaveLength(16);
    const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    expect(
      Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString(),
    ).toBe(TOKEN);
  });
});
