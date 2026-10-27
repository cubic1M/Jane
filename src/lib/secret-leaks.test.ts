import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Leak check over the source (docs/security/keys.md): no log line or API answer names a token,
// a two-factor secret or a key, and only the crypto modules ever hold a key. The runtime
// check is plaid/token-leak.integration.test.ts.

const ROOT = join(process.cwd(), "src");
const SKIP = /(\.test\.tsx?$|^generated\/|^test-setup\/|^accuracy\/)/;

function sources(dir = ROOT): { path: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    const path = relative(ROOT, full);
    if (SKIP.test(path)) return [];
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) ? [{ path, text: readFileSync(full, "utf8") }] : [];
  });
}

// The argument list of each call to `callee`, brackets balanced (strings aren't parsed, which
// is close enough for log and response calls).
function callsTo(text: string, callee: RegExp): string[] {
  const calls: string[] = [];
  for (const match of text.matchAll(new RegExp(`${callee.source}\\s*\\(`, "g"))) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < text.length; end++) {
      if ("([{".includes(text[end])) depth++;
      if (")]}".includes(text[end]) && --depth === 0) break;
    }
    calls.push(text.slice(match.index, end + 1));
  }
  return calls;
}

const SECRET_NAMES =
  /accessToken|access_token|mfaSecret|encryptedBytes|TOKEN_ENCRYPTION_KEY|PLAID_SECRET|decrypt\(|dataKey|wrapped\b/;
const ALL = sources();

describe("secret leak check (source)", () => {
  it("finds the source files", () => {
    expect(ALL.length).toBeGreaterThan(100);
    expect(ALL.map((f) => f.path)).toContain(join("lib", "crypto.ts"));
    const logCalls = ALL.flatMap(({ text }) => callsTo(text, /console\.(?:log|error)/));
    expect(logCalls.length).toBeGreaterThan(10);
  });

  it("never logs a token, secret or key", () => {
    const leaks = ALL.flatMap(({ path, text }) =>
      callsTo(text, /console\.(?:log|info|warn|error|debug|trace|dir)/)
        .filter((call) => SECRET_NAMES.test(call))
        .map((call) => `${path}: ${call.slice(0, 120)}`),
    );
    expect(leaks).toEqual([]);
  });

  it("never answers a request with a token, secret or key", () => {
    const leaks = ALL.flatMap(({ path, text }) =>
      callsTo(text, /(?:NextResponse\.json|Response\.json|new (?:Next)?Response)/)
        .filter((call) => SECRET_NAMES.test(call))
        .map((call) => `${path}: ${call.slice(0, 120)}`),
    );
    expect(leaks).toEqual([]);
  });

  it("never reads an encrypted token in a page or route", () => {
    const readers = ALL.filter(
      ({ path, text }) =>
        path.startsWith(`app${"/"}`) &&
        /accessTokenEncrypted|mfaSecretEncrypted|encryptedBytes:\s*true/.test(text),
    ).map((f) => f.path);
    expect(readers).toEqual([]);
  });

  it("reads the key env vars, and holds keys, only in the crypto modules", () => {
    const envReaders = ALL.filter(({ text }) =>
      /process\.env(?:\.|\[["'])TOKEN_ENCRYPTION_KEY/.test(text),
    ).map((f) => f.path);
    expect(envReaders).toEqual([join("lib", "keyring.ts")]);

    // Keys come out of src/lib/keyring.ts only into crypto.ts.
    const importers = ALL.filter(({ text }) => /from "@\/lib\/keyring"/.test(text));
    const keyHolders = importers
      .filter(({ text }) => /\b(?:keyFor|currentKey|keyring)\(/.test(text))
      .map((f) => f.path)
      .sort();
    expect(keyHolders).toEqual([join("lib", "crypto.ts")]);
  });
});
