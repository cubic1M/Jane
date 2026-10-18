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

// The same scheme for files (spec step 68), as bytes rather than text: a version byte,
// then the iv, the auth tag and the ciphertext.
const BYTES_VERSION = 1;

export function encryptBytes(plaintext: Uint8Array): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  // A plain Uint8Array copy, the type Prisma stores as bytes.
  return new Uint8Array(
    Buffer.concat([Buffer.from([BYTES_VERSION]), iv, cipher.getAuthTag(), ciphertext]),
  );
}

export function decryptBytes(payload: Uint8Array): Buffer {
  const data = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  if (data.length < 1 + IV_BYTES + TAG_BYTES || data[0] !== BYTES_VERSION) {
    throw new Error("Malformed encrypted value");
  }
  const iv = data.subarray(1, 1 + IV_BYTES);
  const tag = data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  // As above: final() throws on any tampering, so partial output is never returned.
  return Buffer.concat([
    decipher.update(data.subarray(1 + IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
}
