import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Time-based one-time passwords (RFC 6238, as used by authenticator apps): HMAC-SHA1,
// 30-second steps, 6 digits. Secrets are 20 random bytes in base32.

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/[\s=]/g, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totp(secret: string, time: Date, step = 0): string {
  const counter = Math.floor(time.getTime() / 1000 / STEP_SECONDS) + step;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, "0");
}

// Accepts the current code and one step either side, for clock drift.
export function verifyTotp(secret: string, code: string, now: Date): boolean {
  const given = Buffer.from(code.replace(/\s/g, ""));
  if (given.length !== DIGITS) return false;
  return [-1, 0, 1].some((step) => {
    const expected = Buffer.from(totp(secret, now, step));
    return timingSafeEqual(given, expected);
  });
}

// The link authenticator apps understand (tap it on a phone to add the account).
export function otpauthUri(label: string, secret: string, issuer = "Financial Controller"): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?${params}`;
}
