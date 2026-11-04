import { createHash, generateKeyPairSync, sign } from "node:crypto";
import type { PlaidApi } from "plaid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WEBHOOK_KEY_LOOKUPS_PER_MINUTE, WEBHOOK_KEY_RECHECK_HOURS } from "@/config/plaid";
import { clearWebhookKeysForTests, verifyPlaidWebhook } from "./webhook-verify";

const NOW = new Date("2026-10-18T12:00:00Z");
const BODY = '{"webhook_code":"SYNC_UPDATES_AVAILABLE"}';
const plaidKey = generateKeyPairSync("ec", { namedCurve: "P-256" });
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function jwt(kid: string, at: Date) {
  const header = b64({ alg: "ES256", kid, typ: "JWT" });
  const payload = b64({
    iat: at.getTime() / 1000,
    request_body_sha256: createHash("sha256").update(BODY).digest("hex"),
  });
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: plaidKey.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

const lookUp = vi.fn();
const api = { webhookVerificationKeyGet: lookUp } as unknown as PlaidApi;
const key = (expired_at: number | null) => ({
  data: { key: { ...plaidKey.publicKey.export({ format: "jwk" }), expired_at } },
});
const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

describe("Plaid's webhook keys", () => {
  beforeEach(() => {
    clearWebhookKeysForTests();
    lookUp.mockReset();
  });

  it("asks Plaid a limited number of times a minute about key ids it has never seen", async () => {
    lookUp.mockRejectedValue(new Error("no such key"));
    for (let i = 0; i < WEBHOOK_KEY_LOOKUPS_PER_MINUTE * 5; i++) {
      await verifyPlaidWebhook(BODY, jwt(`forged-${i}`, NOW), { api, now: NOW });
    }
    expect(lookUp).toHaveBeenCalledTimes(WEBHOOK_KEY_LOOKUPS_PER_MINUTE);
  });

  it("still accepts a key it holds while a flood uses up the lookups", async () => {
    lookUp.mockResolvedValueOnce(key(null));
    expect(await verifyPlaidWebhook(BODY, jwt("real", NOW), { api, now: NOW })).toBe(true);
    lookUp.mockRejectedValue(new Error("no such key"));
    for (let i = 0; i < WEBHOOK_KEY_LOOKUPS_PER_MINUTE + 5; i++) {
      await verifyPlaidWebhook(BODY, jwt(`forged-${i}`, NOW), { api, now: NOW });
    }
    expect(await verifyPlaidWebhook(BODY, jwt("real", NOW), { api, now: NOW })).toBe(true);
  });

  it("asks again the next minute", async () => {
    lookUp.mockRejectedValue(new Error("no such key"));
    for (let i = 0; i < WEBHOOK_KEY_LOOKUPS_PER_MINUTE + 5; i++) {
      await verifyPlaidWebhook(BODY, jwt(`forged-${i}`, NOW), { api, now: NOW });
    }
    lookUp.mockClear().mockResolvedValueOnce(key(null));
    const minuteOn = new Date(NOW.getTime() + 60_000);
    expect(await verifyPlaidWebhook(BODY, jwt("real", minuteOn), { api, now: minuteOn })).toBe(
      true,
    );
  });

  it("stops trusting a key Plaid has since retired", async () => {
    lookUp.mockResolvedValueOnce(key(null));
    expect(await verifyPlaidWebhook(BODY, jwt("old", NOW), { api, now: NOW })).toBe(true);

    const soon = later(1);
    expect(await verifyPlaidWebhook(BODY, jwt("old", soon), { api, now: soon })).toBe(true);
    expect(lookUp).toHaveBeenCalledTimes(1);

    lookUp.mockResolvedValueOnce(key(1_700_000_000));
    const dayOn = later(WEBHOOK_KEY_RECHECK_HOURS + 1);
    expect(await verifyPlaidWebhook(BODY, jwt("old", dayOn), { api, now: dayOn })).toBe(false);
  });

  it("keeps a key it holds when Plaid can't be reached to recheck it", async () => {
    lookUp.mockResolvedValueOnce(key(null));
    await verifyPlaidWebhook(BODY, jwt("kept", NOW), { api, now: NOW });
    lookUp.mockRejectedValueOnce(new Error("Plaid is down"));
    const dayOn = later(WEBHOOK_KEY_RECHECK_HOURS + 1);
    expect(await verifyPlaidWebhook(BODY, jwt("kept", dayOn), { api, now: dayOn })).toBe(true);
  });
});
