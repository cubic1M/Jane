// The encryption keys, read from env vars (docs/security/keys.md). Every encrypted value
// records the key that made it, so keys can be rotated and old ones retired:
//
//   TOKEN_ENCRYPTION_KEYS        "k2:<base64 key>,k3:<base64 key>" (commas, spaces or new lines)
//   TOKEN_ENCRYPTION_KEY_CURRENT "k3": the key new values are written with
//   TOKEN_ENCRYPTION_KEY         the original single key, called "legacy". It reads every
//                                "v1" value, and stays the current key until
//                                TOKEN_ENCRYPTION_KEY_CURRENT is set.
//
// Errors name a key id or a variable, never a key. A broken entry only fails the values
// that need it, so one typo can't stop every bank sync.

export const LEGACY_KEY_ID = "legacy";
export const KEY_BYTES = 32;

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

type Env = Record<string, string | undefined>;

export type Keyring = {
  // The id new values are written with: LEGACY_KEY_ID, or an entry of TOKEN_ENCRYPTION_KEYS.
  current: string;
  // Every usable key by id, the legacy key included when it's set.
  keys: Map<string, Buffer>;
  // What's wrong with the configuration, by key id or variable name, never a value.
  problems: string[];
};

// Decoded the way the single key always was, so today's TOKEN_ENCRYPTION_KEY keeps working.
function decodeKey(raw: string): Buffer | null {
  const key = Buffer.from(raw.trim(), "base64");
  return key.length === KEY_BYTES ? key : null;
}

export function readKeyring(env: Env = process.env): Keyring {
  const keys = new Map<string, Buffer>();
  const problems: string[] = [];

  const legacyRaw = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (legacyRaw) {
    const legacy = decodeKey(legacyRaw);
    if (legacy) keys.set(LEGACY_KEY_ID, legacy);
    else problems.push(`TOKEN_ENCRYPTION_KEY must be ${KEY_BYTES} bytes, base64-encoded`);
  }

  const entries = (env.TOKEN_ENCRYPTION_KEYS ?? "").split(/[\s,]+/).filter(Boolean);
  entries.forEach((entry, index) => {
    const colon = entry.indexOf(":");
    const id = colon > 0 ? entry.slice(0, colon) : "";
    if (!KEY_ID.test(id) || id === LEGACY_KEY_ID) {
      problems.push(
        `TOKEN_ENCRYPTION_KEYS entry ${index + 1} needs a name like "k2:" (letters, digits, - or _; not "${LEGACY_KEY_ID}")`,
      );
      return;
    }
    if (keys.has(id)) {
      problems.push(`TOKEN_ENCRYPTION_KEYS has "${id}" twice`);
      return;
    }
    const key = decodeKey(entry.slice(colon + 1));
    if (key) keys.set(id, key);
    else problems.push(`Key "${id}" must be ${KEY_BYTES} bytes, base64-encoded`);
  });

  const current = env.TOKEN_ENCRYPTION_KEY_CURRENT?.trim() || LEGACY_KEY_ID;
  if (!keys.has(current)) {
    problems.push(
      current === LEGACY_KEY_ID
        ? "TOKEN_ENCRYPTION_KEY is not set"
        : `TOKEN_ENCRYPTION_KEY_CURRENT is "${current}", which is not a working key in TOKEN_ENCRYPTION_KEYS`,
    );
  }
  return { current, keys, problems };
}

// Reading the env on every call keeps tests that stub keys honest; the parse is cached
// while the three variables stay the same.
let cached: { raw: string; keyring: Keyring } | null = null;

export function keyring(env: Env = process.env): Keyring {
  const raw = JSON.stringify([
    env.TOKEN_ENCRYPTION_KEY,
    env.TOKEN_ENCRYPTION_KEYS,
    env.TOKEN_ENCRYPTION_KEY_CURRENT,
  ]);
  if (cached?.raw !== raw) cached = { raw, keyring: readKeyring(env) };
  return cached.keyring;
}

export function keyFor(id: string, ring: Keyring = keyring()): Buffer {
  const key = ring.keys.get(id);
  if (key) return key;
  if (id === LEGACY_KEY_ID) {
    throw new Error(
      process.env.TOKEN_ENCRYPTION_KEY?.trim()
        ? `TOKEN_ENCRYPTION_KEY must be ${KEY_BYTES} bytes, base64-encoded`
        : "TOKEN_ENCRYPTION_KEY is not set",
    );
  }
  throw new Error(`Encryption key "${id}" is not configured`);
}

export function currentKey(ring: Keyring = keyring()): { id: string; key: Buffer } {
  if (ring.current === LEGACY_KEY_ID)
    return { id: LEGACY_KEY_ID, key: keyFor(LEGACY_KEY_ID, ring) };
  const key = ring.keys.get(ring.current);
  if (!key) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY_CURRENT is "${ring.current}", which is not a working key in TOKEN_ENCRYPTION_KEYS`,
    );
  }
  return { id: ring.current, key };
}
