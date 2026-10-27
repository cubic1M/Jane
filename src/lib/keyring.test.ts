import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LEGACY_KEY_ID, currentKey, keyFor, readKeyring } from "./keyring";

const key = () => randomBytes(32).toString("base64");

describe("readKeyring", () => {
  it("keeps today's single key working on its own, as the current key", () => {
    const legacy = key();
    const ring = readKeyring({ TOKEN_ENCRYPTION_KEY: legacy });
    expect(ring.current).toBe(LEGACY_KEY_ID);
    expect(ring.problems).toEqual([]);
    expect(currentKey(ring).key.equals(Buffer.from(legacy, "base64"))).toBe(true);
  });

  it("reads named keys separated by commas, spaces or new lines", () => {
    const [k2, k3] = [key(), key()];
    const ring = readKeyring({
      TOKEN_ENCRYPTION_KEY: key(),
      TOKEN_ENCRYPTION_KEYS: ` k2:${k2},\n k3:${k3} `,
      TOKEN_ENCRYPTION_KEY_CURRENT: "k3",
    });
    expect([...ring.keys.keys()]).toEqual([LEGACY_KEY_ID, "k2", "k3"]);
    expect(currentKey(ring)).toMatchObject({ id: "k3" });
    expect(keyFor("k2", ring).equals(Buffer.from(k2, "base64"))).toBe(true);
    expect(ring.problems).toEqual([]);
  });

  it("stays on the original key until a current key is named", () => {
    const ring = readKeyring({ TOKEN_ENCRYPTION_KEY: key(), TOKEN_ENCRYPTION_KEYS: `k2:${key()}` });
    expect(ring.current).toBe(LEGACY_KEY_ID);
  });

  it("names every problem without a key in it, and keeps the good keys", () => {
    const good = key();
    const short = randomBytes(16).toString("base64");
    const ring = readKeyring({
      TOKEN_ENCRYPTION_KEYS: `k2:${good},k2:${good},k3:${short},${good},legacy:${good}`,
      TOKEN_ENCRYPTION_KEY_CURRENT: "k3",
    });
    expect([...ring.keys.keys()]).toEqual(["k2"]);
    expect(ring.problems).toEqual([
      'TOKEN_ENCRYPTION_KEYS has "k2" twice',
      'Key "k3" must be 32 bytes, base64-encoded',
      'TOKEN_ENCRYPTION_KEYS entry 4 needs a name like "k2:" (letters, digits, - or _; not "legacy")',
      'TOKEN_ENCRYPTION_KEYS entry 5 needs a name like "k2:" (letters, digits, - or _; not "legacy")',
      'TOKEN_ENCRYPTION_KEY_CURRENT is "k3", which is not a working key in TOKEN_ENCRYPTION_KEYS',
    ]);
    expect(JSON.stringify(ring.problems)).not.toContain(good);
    expect(JSON.stringify(ring.problems)).not.toContain(short);
    expect(() => currentKey(ring)).toThrow('TOKEN_ENCRYPTION_KEY_CURRENT is "k3"');
  });

  it("fails safely with no key at all", () => {
    const ring = readKeyring({});
    expect(ring.problems).toEqual(["TOKEN_ENCRYPTION_KEY is not set"]);
    expect(() => currentKey(ring)).toThrow("TOKEN_ENCRYPTION_KEY is not set");
    expect(() => keyFor("k2", ring)).toThrow('Encryption key "k2" is not configured');
  });
});
