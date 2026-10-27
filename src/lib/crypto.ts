import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { LEGACY_KEY_ID, currentKey, keyFor, keyring } from "@/lib/keyring";

// AES-256-GCM for secrets at rest (Plaid access tokens, two-factor secrets, uploaded files),
// with the keys from src/lib/keyring.ts. Two formats, each part base64url:
//
//   "v1.<iv>.<tag>.<ciphertext>"                 the legacy key (TOKEN_ENCRYPTION_KEY), as
//                                                written before key rotation existed
//   "v2.<key id>.<wrapped data key>.<iv>.<tag>.<ciphertext>"
//                                                envelope encryption: each value gets its own
//                                                random data key, wrapped (encrypted) by the
//                                                named master key
//
// New values are v1 while the legacy key is current (so a rollback to older code can still
// read them), v2 once TOKEN_ENCRYPTION_KEY_CURRENT names a new key. Rotation re-wraps the
// data key only, so a file is never decrypted to move it to a new key.
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DATA_KEY_BYTES = 32;
const WRAPPED_BYTES = IV_BYTES + TAG_BYTES + DATA_KEY_BYTES;

type Sealed = { iv: Buffer; tag: Buffer; ciphertext: Buffer };

function seal(key: Buffer, plaintext: Uint8Array, aad?: Buffer): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function open(key: Buffer, { iv, tag, ciphertext }: Sealed, aad?: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  // final() throws if the ciphertext, tag or key don't match; never return partial output.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// The wrapped data key is tied to its key id, so a relabelled value fails rather than
// being tried under another key.
const wrapAad = (keyId: string) => Buffer.from(`jane-data-key:${keyId}`);

function wrap(keyId: string, master: Buffer, dataKey: Buffer): Buffer {
  const { iv, tag, ciphertext } = seal(master, dataKey, wrapAad(keyId));
  return Buffer.concat([iv, tag, ciphertext]);
}

function unwrap(keyId: string, wrapped: Buffer): Buffer {
  if (wrapped.length !== WRAPPED_BYTES) throw new Error("Malformed encrypted value");
  return open(
    keyFor(keyId),
    {
      iv: wrapped.subarray(0, IV_BYTES),
      tag: wrapped.subarray(IV_BYTES, IV_BYTES + TAG_BYTES),
      ciphertext: wrapped.subarray(IV_BYTES + TAG_BYTES),
    },
    wrapAad(keyId),
  );
}

// One parsed value, whichever format and shape (text or bytes) it came in.
type Envelope =
  ({ version: 1 } & Sealed) | ({ version: 2; keyId: string; wrapped: Buffer } & Sealed);

function openEnvelope(envelope: Envelope): Buffer {
  if (envelope.version === 1) return open(keyFor(LEGACY_KEY_ID), envelope);
  return open(unwrap(envelope.keyId, envelope.wrapped), envelope);
}

function sealEnvelope(plaintext: Uint8Array): Envelope {
  const { id, key } = currentKey();
  if (id === LEGACY_KEY_ID) return { version: 1, ...seal(key, plaintext) };
  const dataKey = randomBytes(DATA_KEY_BYTES);
  return { version: 2, keyId: id, wrapped: wrap(id, key, dataKey), ...seal(dataKey, plaintext) };
}

// The same value under the current key, or null when it already is. v2 to v2 re-wraps the
// data key and keeps the ciphertext; to or from the legacy format re-encrypts.
function rotateEnvelope(envelope: Envelope): Envelope | null {
  const target = keyring().current;
  if (keyIdOfEnvelope(envelope) === target) return null;
  if (envelope.version === 2 && target !== LEGACY_KEY_ID) {
    const { id, key } = currentKey();
    return {
      ...envelope,
      keyId: id,
      wrapped: wrap(id, key, unwrap(envelope.keyId, envelope.wrapped)),
    };
  }
  return sealEnvelope(openEnvelope(envelope));
}

const keyIdOfEnvelope = (envelope: Envelope) =>
  envelope.version === 1 ? LEGACY_KEY_ID : envelope.keyId;

// --- Text: Plaid access tokens, two-factor secrets ---

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

function parseText(payload: string): Envelope {
  const parts = payload.split(".");
  const b = (part: string) => Buffer.from(part, "base64url");
  if (parts[0] === "v1" && parts.length === 4 && parts[1] && parts[2]) {
    return { version: 1, iv: b(parts[1]), tag: b(parts[2]), ciphertext: b(parts[3]) };
  }
  if (
    parts[0] === "v2" &&
    parts.length === 6 &&
    KEY_ID.test(parts[1]) &&
    parts[2] &&
    parts[3] &&
    parts[4]
  ) {
    return {
      version: 2,
      keyId: parts[1],
      wrapped: b(parts[2]),
      iv: b(parts[3]),
      tag: b(parts[4]),
      ciphertext: b(parts[5]),
    };
  }
  throw new Error("Malformed encrypted value");
}

function formatText(envelope: Envelope): string {
  const tail = [envelope.iv, envelope.tag, envelope.ciphertext].map((p) => p.toString("base64url"));
  return envelope.version === 1
    ? ["v1", ...tail].join(".")
    : ["v2", envelope.keyId, envelope.wrapped.toString("base64url"), ...tail].join(".");
}

export function encrypt(plaintext: string): string {
  return formatText(sealEnvelope(Buffer.from(plaintext, "utf8")));
}

export function decrypt(payload: string): string {
  return openEnvelope(parseText(payload)).toString("utf8");
}

// Which key made a value, read from its label without decrypting it.
export function keyIdOf(payload: string): string {
  return keyIdOfEnvelope(parseText(payload));
}

// The value under the current key, or null if it already is (rotation, src/lib/key-rotation.ts).
export function rotate(payload: string): string | null {
  const rotated = rotateEnvelope(parseText(payload));
  return rotated && formatText(rotated);
}

// --- Bytes: uploaded files (spec step 68) ---
// v1: [1][iv][tag][ciphertext]. v2: [2][key id length][key id][wrapped data key][iv][tag][ciphertext].

// Enough leading bytes to read any file's key id (keyIdOfBytes); the rotation job reads
// only this much of each file.
export const BYTES_HEADER_LENGTH = 2 + 32;

function parseBytes(payload: Uint8Array): Envelope {
  const data = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  const sealedFrom = (start: number): Sealed => ({
    iv: data.subarray(start, start + IV_BYTES),
    tag: data.subarray(start + IV_BYTES, start + IV_BYTES + TAG_BYTES),
    ciphertext: data.subarray(start + IV_BYTES + TAG_BYTES),
  });
  if (data[0] === 1 && data.length >= 1 + IV_BYTES + TAG_BYTES) {
    return { version: 1, ...sealedFrom(1) };
  }
  if (data[0] === 2 && data.length >= 2) {
    const idEnd = 2 + data[1];
    const keyId = data.subarray(2, idEnd).toString("latin1");
    const sealedStart = idEnd + WRAPPED_BYTES;
    if (KEY_ID.test(keyId) && data.length >= sealedStart + IV_BYTES + TAG_BYTES) {
      return {
        version: 2,
        keyId,
        wrapped: data.subarray(idEnd, sealedStart),
        ...sealedFrom(sealedStart),
      };
    }
  }
  throw new Error("Malformed encrypted value");
}

function formatBytes(envelope: Envelope): Uint8Array<ArrayBuffer> {
  const head =
    envelope.version === 1
      ? [Buffer.from([1])]
      : [
          Buffer.from([2, envelope.keyId.length]),
          Buffer.from(envelope.keyId, "latin1"),
          envelope.wrapped,
        ];
  // A plain Uint8Array copy, the type Prisma stores as bytes.
  return new Uint8Array(Buffer.concat([...head, envelope.iv, envelope.tag, envelope.ciphertext]));
}

export function encryptBytes(plaintext: Uint8Array): Uint8Array<ArrayBuffer> {
  return formatBytes(sealEnvelope(plaintext));
}

export function decryptBytes(payload: Uint8Array): Buffer {
  return openEnvelope(parseBytes(payload));
}

// Which key made a file, from its first BYTES_HEADER_LENGTH bytes (or all of it).
export function keyIdOfBytes(head: Uint8Array): string {
  const data = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  if (data[0] === 1) return LEGACY_KEY_ID;
  const keyId = data[0] === 2 ? data.subarray(2, 2 + data[1]).toString("latin1") : "";
  if (!KEY_ID.test(keyId) || data.length < 2 + data[1])
    throw new Error("Malformed encrypted value");
  return keyId;
}

export function rotateBytes(payload: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const rotated = rotateEnvelope(parseBytes(payload));
  return rotated && formatBytes(rotated);
}
