import { createHmac, timingSafeEqual } from "node:crypto";

// Unsubscribe links work without signing in, so the token itself proves which person it
// is for: their id plus an HMAC of it, keyed from AUTH_SECRET.

function signature(userId: string): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(`unsubscribe:${userId}`).digest();
}

export function unsubscribeToken(userId: string): string {
  return `${Buffer.from(userId).toString("base64url")}.${signature(userId).toString("base64url")}`;
}

// The user id the token was made for, or null if it's not a token we made.
export function userFromUnsubscribeToken(token: string | null | undefined): string | null {
  const [idPart, sigPart, ...rest] = (token ?? "").split(".");
  if (!idPart || !sigPart || rest.length > 0) return null;
  const userId = Buffer.from(idPart, "base64url").toString("utf8");
  const given = Buffer.from(sigPart, "base64url");
  const expected = signature(userId);
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}
