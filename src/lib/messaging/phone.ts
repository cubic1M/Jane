import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { TEXT_CODE_DIGITS } from "@/config/messaging";

// Phone numbers and verification codes for texts (spec step 78). Numbers are US only, kept
// as E.164 (+1 and ten digits). Never log a number or a code.

// A US number in E.164, or null. Accepts the usual ways of writing one: (415) 555-2671,
// 415.555.2671, +1 415 555 2671, 1-415-555-2671. Area codes and exchanges can't start with
// 0 or 1 (the North American Numbering Plan).
export function normalizeUsPhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 30) return null;
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && !digits.startsWith("1")) return null;
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

// "(•••) •••-2671": enough for the person to recognise their number on /settings.
export function maskPhone(e164: string): string {
  return `(•••) •••-${e164.slice(-4)}`;
}

function hmacKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  return Buffer.from(raw, "base64");
}

// A stable, keyed fingerprint of a number, to find its owner from an inbound text without
// decrypting every row. Keyed, so a database leak alone can't be matched to numbers.
export function phoneHmac(e164: string): string {
  return createHmac("sha256", hmacKey()).update(`phone:${e164}`).digest("hex");
}

export function newCode(): string {
  return String(randomInt(0, 10 ** TEXT_CODE_DIGITS)).padStart(TEXT_CODE_DIGITS, "0");
}

// The stored form of a code: keyed and tied to the person, so it's useless elsewhere.
export function hashCode(userId: string, code: string): string {
  return createHmac("sha256", hmacKey()).update(`text-code:${userId}:${code}`).digest("hex");
}

export function codeMatches(userId: string, code: string, stored: string): boolean {
  const cleaned = code.replace(/\s/g, "");
  if (!new RegExp(`^\\d{${TEXT_CODE_DIGITS}}$`).test(cleaned)) return false;
  const actual = Buffer.from(hashCode(userId, cleaned), "hex");
  const expected = Buffer.from(stored, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
