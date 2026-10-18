import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for secrets at rest (Plaid access tokens). Output format:
// "v1.<iv>.<auth tag>.<ciphertext>", each part base64url. The version prefix lets us
// rotate the scheme later without guessing how old values were written.
const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must be ${KEY_BYTES} bytes, base64-encoded`);
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ciphertext, ...rest] = payload.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
    throw new Error("Malformed encrypted value");
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, "base64url"), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  // final() throws if the ciphertext, tag or key don't match; never return partial output.
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
