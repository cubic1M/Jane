import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";
import { NO_SECRETS, openSecrets, sealSecrets, type GmailSecrets } from "./secrets";

// A mailbox's tokens at rest: one sealed value that shows nothing of what is inside, opens only as
// what was sealed, and refuses anything else without repeating it.

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");

// Made here, so no token-shaped text sits in the source.
const tokens = (): { accessToken: string; refreshToken: string } => ({
  accessToken: `access-${randomUUID()}`,
  refreshToken: `refresh-${randomUUID()}`,
});

// Every way the text of a token could show in a value that was only encoded, not encrypted.
function showsIn(sealed: string, token: string): boolean {
  const decoded = sealed
    .split(".")
    .map((part) => Buffer.from(part, "base64url").toString("latin1"));
  const forms = [
    token,
    Buffer.from(token).toString("base64"),
    Buffer.from(token).toString("base64url"),
    Buffer.from(token).toString("hex"),
  ];
  return forms.some((form) => sealed.includes(form)) || decoded.some((d) => d.includes(token));
}

// The same value with one bit of its encrypted part changed.
function tampered(sealed: string): string {
  const parts = sealed.split(".");
  const last = Buffer.from(parts[parts.length - 1], "base64url");
  last[0] ^= 0x01;
  return [...parts.slice(0, -1), last.toString("base64url")].join(".");
}

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
  vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sealing a mailbox's tokens", () => {
  it("opens to exactly what was sealed", () => {
    const both = tokens();
    expect(openSecrets(sealSecrets(both))).toEqual(both);
    const accessGone = { accessToken: null, refreshToken: both.refreshToken };
    expect(openSecrets(sealSecrets(accessGone))).toEqual(accessGone);
  });

  it("holds no token text, in any encoding", () => {
    const { accessToken, refreshToken } = tokens();
    const sealed = sealSecrets({ accessToken, refreshToken });
    expect(showsIn(sealed, accessToken)).toBe(false);
    expect(showsIn(sealed, refreshToken)).toBe(false);
    expect(sealed).not.toMatch(/accessToken|refreshToken/);
    // The check itself sees a token that was only encoded.
    expect(showsIn(`v0.${Buffer.from(accessToken).toString("base64url")}`, accessToken)).toBe(true);
  });

  it("never seals the same tokens to the same value, so two rows can't be compared", () => {
    const same = tokens();
    expect(sealSecrets(same)).not.toBe(sealSecrets(same));
  });

  it("seals the two tokens and nothing else it is handed", () => {
    const answer = { ...tokens(), expiresAt: new Date(), scope: "anything", idToken: "x" };
    const inside: unknown = JSON.parse(decrypt(sealSecrets(answer)));
    expect(inside).toEqual({ accessToken: answer.accessToken, refreshToken: answer.refreshToken });
  });
});

describe("a mailbox with no tokens", () => {
  it("seals and opens as none", () => {
    expect(openSecrets(sealSecrets(NO_SECRETS))).toEqual({ accessToken: null, refreshToken: null });
  });

  it("can't be given a token by a caller that holds it", () => {
    const held = NO_SECRETS as GmailSecrets;
    expect(() => {
      held.accessToken = tokens().accessToken;
    }).toThrow(TypeError);
    expect(NO_SECRETS).toEqual({ accessToken: null, refreshToken: null });
  });
});

describe("a value that isn't a mailbox's sealed tokens", () => {
  it.each([
    ["text that was never encrypted", () => "planted-marker-text"],
    ["nothing at all", () => ""],
    ["the tokens as plain JSON", () => JSON.stringify(tokens())],
    [
      "a sealed value with a part cut off",
      () => sealSecrets(tokens()).split(".").slice(0, 3).join("."),
    ],
    ["a sealed value with one bit changed", () => tampered(sealSecrets(tokens()))],
  ])("won't open: %s", (_what, value) => {
    expect(() => openSecrets(value())).toThrow();
  });

  it("won't open under another key", () => {
    const sealed = sealSecrets(tokens());
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", OTHER_KEY);
    expect(() => openSecrets(sealed)).toThrow();
  });

  // Sealed with the same key by something else of ours, so it decrypts: its shape is what refuses.
  it.each([
    ["a Connect link's ticket", { for: "gmail_connect", userId: "user_1", at: 1 }],
    ["a sign-in cookie", { for: "gmail_sign_in", state: "s", verifier: "v", userId: "user_1" }],
    ["an empty object", {}],
    ["only one of the two", { accessToken: "a" }],
    ["a token that isn't text", { accessToken: 5, refreshToken: null }],
    ["tokens in a list", ["a", "b"]],
    ["a bare string", "a"],
    ["null", null],
  ])("won't open %s as tokens", (_what, inside) => {
    expect(() => openSecrets(encrypt(JSON.stringify(inside)))).toThrow(
      "Not a mailbox's sealed tokens",
    );
  });

  it("says nothing of what was inside when it refuses", () => {
    const { accessToken, refreshToken } = tokens();
    const refused = [
      // Not JSON: JSON's own error would quote it.
      encrypt(accessToken),
      encrypt(`{"accessToken":"${accessToken}",`),
      // JSON, but not ours.
      encrypt(JSON.stringify({ accessToken, refreshToken: 5 })),
      encrypt(JSON.stringify([accessToken, refreshToken])),
    ];
    for (const sealed of refused) {
      let message = "it opened";
      try {
        openSecrets(sealed);
      } catch (error) {
        message = String(error);
      }
      expect(message).toBe("Error: Not a mailbox's sealed tokens");
      expect(message).not.toContain(accessToken);
    }
  });
});

// The app's own source: tests, what only tests use and generated code left out.
const SRC = join(process.cwd(), "src");
const NOT_THE_APP = /^(generated|test-setup|accuracy)$|(^|\/)__fixtures__$/;
function sources(dir = SRC): { path: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    const path = relative(SRC, full);
    if (entry.isDirectory()) return NOT_THE_APP.test(path) ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [{ path, text: readFileSync(full, "utf8") }]
      : [];
  });
}
// A file that takes something from this module, whatever the path is written as.
const IMPORTS_SECRETS = /(?:from|import\()\s*"[^"]*\/gmail\/secrets"/;

describe("where a mailbox's tokens are opened", () => {
  const all = sources();
  const HERE = "lib/gmail/";

  it("finds the source, and knows an import of this module when it sees one", () => {
    expect(all.length).toBeGreaterThan(100);
    expect(all.map((f) => f.path)).toContain(`${HERE}secrets.ts`);
    expect(all.some((f) => /__fixtures__|\.test\./.test(f.path))).toBe(false);
    expect(IMPORTS_SECRETS.test('import { openSecrets } from "@/lib/gmail/secrets";')).toBe(true);
    expect(IMPORTS_SECRETS.test('const { openSecrets } = await import("../gmail/secrets");')).toBe(
      true,
    );
    expect(IMPORTS_SECRETS.test('import { openSecrets } from "@/lib/robinhood/secrets";')).toBe(
      false,
    );
  });

  it("only inside src/lib/gmail: nothing else takes openSecrets from this module", () => {
    const outside = all
      .filter(({ path }) => !path.startsWith(HERE))
      .filter(({ text }) => IMPORTS_SECRETS.test(text) && /\bopenSecrets\b/.test(text))
      .map((f) => f.path);
    expect(outside, "give the caller what it needs from src/lib/gmail instead").toEqual([]);
  });

  it("only by openSecrets: no other file there decrypts what a mailbox row holds", () => {
    const others = all
      .filter(({ path }) => path.startsWith(HERE) && path !== `${HERE}secrets.ts`)
      .filter(({ text }) => /secretsEncrypted/.test(text) && /\bdecrypt\(/.test(text))
      .map((f) => f.path);
    expect(others, "open a mailbox's tokens with openSecrets").toEqual([]);
  });

  it("never in a page, a route or an action: none of them names the sealed column", () => {
    const readers = all
      .filter(({ path, text }) => path.startsWith("app/") && /secretsEncrypted/.test(text))
      .map((f) => f.path);
    expect(readers).toEqual([]);
  });
});
