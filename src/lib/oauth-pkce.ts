import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { decrypt } from "@/lib/crypto";

// The authorization code flow with PKCE (RFC 7636) and state, shared by the Robinhood connection
// (src/lib/robinhood/oauth.ts) and connectors (src/lib/connectors/). What the browser keeps until the
// person comes back is encrypted, so the verifier stays secret, and names them, so it only works for
// the person who started.

export const randomValue = (): string => randomBytes(32).toString("base64url");

// S256: the challenge sent out is the verifier's SHA-256; the verifier goes only to the token call.
export const pkceChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// What a sign-in keeps in its cookie, at least. Encrypt it whole (src/lib/crypto.ts) before it goes.
type SignInStart = { state: string; userId: string; at: number };

// The sign-in this browser started, if this answer belongs to it: the same person, within the time
// and with the state that went out. Anything else, including a cookie that won't decrypt, is null.
export function openSignIn<T extends SignInStart>(
  cookie: string | undefined,
  {
    userId,
    state,
    maxAgeMs,
    now = Date.now(),
  }: { userId: string; state: string | null; maxAgeMs: number; now?: number },
): T | null {
  if (!cookie || !state) return null;
  let signIn: T;
  try {
    signIn = JSON.parse(decrypt(cookie)) as T;
  } catch {
    return null;
  }
  const fresh = now - signIn.at < maxAgeMs;
  return fresh && signIn.userId === userId && sameText(signIn.state, state) ? signIn : null;
}
