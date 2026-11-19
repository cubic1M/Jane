import { constants, createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { GMAIL_LIMITS, googleServer } from "@/config/gmail";
import { call, jsonOf } from "./google";

// Checks that a notice sent to /api/gmail/webhook is Google's before anything acts on it, following
// https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions: an RS256 JWT in the
// Authorization header, signed by one of Google's published keys, made for the audience set on
// Jane's push subscription and for the service account that subscription signs with. The token says
// who is calling, not what they sent, and Google uses one for up to an hour: so its age is no reason
// to refuse it, and a notice sent twice can at most cause a read from Jane's own saved place.
// Never throws, and logs nothing.

// Both are Google, by its own account of its tokens.
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

// Google's whole published set, by key id, and when it was fetched. Plaid is asked for one key at
// a time; Google publishes them together, so a key id nobody has seen costs one fetch of the set at
// most, however many made-up ones arrive.
let held: { keys: Map<string, JsonWebKey>; at: number } | null = null;
// When the set was last asked for, whether or not it came.
let askedAt: number | null = null;
// A fetch under way: notices that arrive meanwhile wait for it rather than be refused.
let fetching: Promise<void> | null = null;

export function clearGmailWebhookKeysForTests(): void {
  held = null;
  askedAt = null;
  fetching = null;
}

function base64urlJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// The keys Google publishes now, or null when they can't be had. An answer with no key in it counts
// as not had, so it can't empty the set already held.
async function publishedKeys(fetcher: typeof call): Promise<Map<string, JsonWebKey> | null> {
  try {
    const response = await fetcher(googleServer().certs, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const { keys } = await jsonOf(response, GMAIL_LIMITS.signInAnswerBytes);
    if (!Array.isArray(keys)) return null;
    const byId = new Map<string, JsonWebKey>();
    for (const key of keys as unknown[]) {
      const kid = typeof key === "object" && key !== null && "kid" in key ? key.kid : null;
      if (typeof kid === "string") byId.set(kid, key as JsonWebKey);
    }
    return byId.size > 0 ? byId : null;
  } catch {
    return null;
  }
}

// How far apart two times are. Either way round, so a clock set back can't keep an old set for good.
const apart = (a: number, b: number): number => Math.abs(a - b);

async function keyFor(kid: string, now: Date, fetcher: typeof call): Promise<JsonWebKey | null> {
  const at = now.getTime();
  const old = !held || apart(at, held.at) >= GMAIL_LIMITS.keysHours * 3_600_000;
  if (old || !held?.keys.has(kid)) {
    const waited = askedAt === null || apart(at, askedAt) >= GMAIL_LIMITS.keysRefetchSeconds * 1000;
    if (!fetching && waited) {
      askedAt = at;
      fetching = publishedKeys(fetcher)
        .then((keys) => {
          // Google being unreachable doesn't turn away keys it already published.
          if (keys) held = { keys, at };
        })
        .finally(() => {
          fetching = null;
        });
    }
    if (fetching) await fetching;
  }
  return held?.keys.get(kid) ?? null;
}

async function verified(
  authorization: string | null,
  now: Date,
  fetcher: typeof call,
): Promise<boolean> {
  const token = /^Bearer (\S+)$/i.exec(authorization?.trim() ?? "")?.[1];
  const parts = token?.split(".") ?? [];
  if (parts.length !== 3) return false;
  const [headerPart, claimsPart, signaturePart] = parts;
  const header = base64urlJson(headerPart);
  const claims = base64urlJson(claimsPart);
  // RS256 and nothing else: "none", or an HMAC made from the public key, gets no further.
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") return false;

  // What the token says of itself, before any key is fetched for it: a token made for someone
  // else's subscription, however well signed, costs nothing. With either setting unset there is
  // nothing to hold a token to, so none is taken.
  const audience = process.env.GMAIL_PUSH_AUDIENCE?.trim();
  const sender = process.env.GMAIL_PUSH_SERVICE_ACCOUNT?.trim();
  if (!audience || !sender) return false;
  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) return false;
  if (claims.aud !== audience || claims.email !== sender || claims.email_verified !== true) {
    return false;
  }

  const jwk = await keyFor(header.kid, now, fetcher);
  // An RSA key only. Node checks a signature by the kind of key it is handed, whatever name the
  // check is given, so another kind would be judged by its own rules.
  if (!jwk || jwk.kty !== "RSA") return false;
  const key = createPublicKey({ key: jwk, format: "jwk" });
  if (key.asymmetricKeyType !== "rsa") return false;
  const signed = verify(
    "RSA-SHA256",
    Buffer.from(`${headerPart}.${claimsPart}`),
    { key, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(signaturePart, "base64url"),
  );
  if (!signed) return false;

  // Not ended, and not from the future. Nothing about how long ago it was made: Google sends the
  // same token for up to an hour.
  const seconds = now.getTime() / 1000;
  const skew = GMAIL_LIMITS.clockSkewSeconds;
  return (
    typeof claims.exp === "number" &&
    typeof claims.iat === "number" &&
    claims.exp > seconds - skew &&
    claims.iat <= seconds + skew
  );
}

export async function verifyGmailWebhook(
  authorization: string | null,
  { now = new Date(), fetcher = call }: { now?: Date; fetcher?: typeof call } = {},
): Promise<boolean> {
  try {
    return await verified(authorization, now, fetcher);
  } catch {
    // A key that isn't one, or anything else unexpected: not verified.
    return false;
  }
}
