import { createHash, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";
import type { PlaidApi } from "plaid";
import { WEBHOOK_MAX_AGE_SECONDS } from "@/config/plaid";
import { plaid, plaidCall } from "./client";

// Checks a Plaid webhook before anything acts on it, following
// https://plaid.com/docs/api/webhooks/webhook-verification/: an ES256 JWT in the
// Plaid-Verification header, signed by a key from /webhook_verification_key/get, issued in
// the last 5 minutes, carrying the SHA-256 of the exact body.

const keys = new Map<string, JsonWebKey>();

export function clearWebhookKeysForTests(): void {
  keys.clear();
}

function base64urlJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function keyFor(kid: string, api: PlaidApi): Promise<JsonWebKey | null> {
  const cached = keys.get(kid);
  if (cached) return cached;
  try {
    const data = await plaidCall(api.webhookVerificationKeyGet({ key_id: kid }));
    if (data.key.expired_at !== null) return null;
    const jwk: JsonWebKey = {
      kty: data.key.kty,
      crv: data.key.crv,
      x: data.key.x,
      y: data.key.y,
    };
    keys.set(kid, jwk);
    return jwk;
  } catch {
    return null;
  }
}

export async function verifyPlaidWebhook(
  rawBody: string,
  jwt: string | null,
  { api = plaid(), now = new Date() }: { api?: PlaidApi; now?: Date } = {},
): Promise<boolean> {
  if (!jwt) return false;
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = base64urlJson(headerPart);
  const claims = base64urlJson(payloadPart);
  if (!header || !claims || header.alg !== "ES256" || typeof header.kid !== "string") return false;

  const jwk = await keyFor(header.kid, api);
  if (!jwk) return false;
  const signed = verify(
    "sha256",
    Buffer.from(`${headerPart}.${payloadPart}`),
    { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
    Buffer.from(signaturePart, "base64url"),
  );
  if (!signed) return false;

  const issuedAt = typeof claims.iat === "number" ? claims.iat : 0;
  if (now.getTime() / 1000 - issuedAt > WEBHOOK_MAX_AGE_SECONDS) return false;

  const expected = typeof claims.request_body_sha256 === "string" ? claims.request_body_sha256 : "";
  const actual = createHash("sha256").update(rawBody).digest("hex");
  return (
    expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
  );
}
