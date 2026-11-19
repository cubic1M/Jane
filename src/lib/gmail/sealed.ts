import { decrypt, encrypt } from "@/lib/crypto";

// A small value the server hands to a browser and takes back later: the Connect link's ticket
// (./connect-ticket.ts) and the notice a redirect leaves for the mailboxes page (./notice.ts).
// Encrypted (src/lib/crypto.ts), so it can't be read or made up, and it carries what it is for, who
// it is for and when it was made: all three are checked when it comes back. Everything else the
// app encrypts uses the same key, so a mailbox's tokens or a sign-in cookie would decrypt here too;
// the purpose is what stops one being taken for another. Opening never throws: a value that won't
// open, for any reason, is null.

export function seal(purpose: string, userId: string, data: unknown, now: Date): string {
  return encrypt(JSON.stringify({ for: purpose, userId, at: now.getTime(), data }));
}

// What was sealed, or null: not sealed by this app, for another purpose, for another person, or
// older than `maxAgeMs`.
export function open(
  value: string | null | undefined,
  purpose: string,
  userId: string,
  maxAgeMs: number,
  now: Date,
): unknown {
  if (!value) return null;
  let inside: unknown;
  try {
    inside = JSON.parse(decrypt(value));
  } catch {
    return null;
  }
  if (typeof inside !== "object" || inside === null) return null;
  const { for: madeFor, userId: owner, at, data } = inside as Record<string, unknown>;
  const fresh = typeof at === "number" && now.getTime() - at < maxAgeMs;
  return fresh && madeFor === purpose && owner === userId ? (data ?? null) : null;
}
