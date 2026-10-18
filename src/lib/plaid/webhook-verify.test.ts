import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { PlaidApi } from "plaid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearWebhookKeysForTests, verifyPlaidWebhook } from "./webhook-verify";

const NOW = new Date("2026-10-18T12:00:00Z");
const BODY = JSON.stringify(
  { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item_1" },
  null,
  2,
);

const plaidKey = generateKeyPairSync("ec", { namedCurve: "P-256" });
const attackerKey = generateKeyPairSync("ec", { namedCurve: "P-256" });

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function jwt({
  key = plaidKey.privateKey,
  alg = "ES256",
  kid = "kid_1",
  iat = NOW.getTime() / 1000,
  body = BODY,
}: { key?: KeyObject; alg?: string; kid?: string; iat?: number; body?: string } = {}) {
  const header = b64({ alg, kid, typ: "JWT" });
  const payload = b64({
    iat,
    request_body_sha256: createHash("sha256").update(body).digest("hex"),
  });
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

const webhookVerificationKeyGet = vi.fn();
const api = { webhookVerificationKeyGet } as unknown as PlaidApi;

describe("verifyPlaidWebhook", () => {
  beforeEach(() => {
    clearWebhookKeysForTests();
    const jwk = plaidKey.publicKey.export({ format: "jwk" });
    webhookVerificationKeyGet.mockReset().mockResolvedValue({
      data: {
        key: { ...jwk, alg: "ES256", kid: "kid_1", use: "sig", created_at: 1, expired_at: null },
      },
    });
  });

  const verify = (body: string, token: string | null) =>
    verifyPlaidWebhook(body, token, { api, now: NOW });

  it("accepts a webhook signed by Plaid's key over this exact body", async () => {
    expect(await verify(BODY, jwt())).toBe(true);
    expect(webhookVerificationKeyGet).toHaveBeenCalledWith({ key_id: "kid_1" });
  });

  it("rejects a forged signature", async () => {
    expect(await verify(BODY, jwt({ key: attackerKey.privateKey }))).toBe(false);
  });

  it("rejects a body that doesn't match the signed hash", async () => {
    expect(await verify(BODY.replace("item_1", "item_2"), jwt())).toBe(false);
  });

  it("rejects a webhook signed more than 5 minutes ago", async () => {
    expect(await verify(BODY, jwt({ iat: NOW.getTime() / 1000 - 301 }))).toBe(false);
  });

  it("rejects other algorithms, a missing header and garbage", async () => {
    expect(await verify(BODY, jwt({ alg: "none" }))).toBe(false);
    expect(await verify(BODY, null)).toBe(false);
    expect(await verify(BODY, "not.a.jwt")).toBe(false);
  });

  it("rejects an expired or unknown key", async () => {
    webhookVerificationKeyGet.mockResolvedValueOnce({
      data: { key: { kid: "kid_1", expired_at: 123 } },
    });
    expect(await verify(BODY, jwt())).toBe(false);

    webhookVerificationKeyGet.mockRejectedValueOnce(new Error("not found"));
    expect(await verify(BODY, jwt({ kid: "kid_2" }))).toBe(false);
  });
});
