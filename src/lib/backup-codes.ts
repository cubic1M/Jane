import { createHash, createHmac, randomInt } from "node:crypto";
import { BACKUP_CODE_COUNT, BACKUP_CODE_LENGTH } from "@/config/two-factor";

// No 0/O or 1/I/L, so codes copied from paper aren't misread.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

// Ignores case, spaces and dashes, so "ABCDE-FGHJK" and "abcde fghjk" are the same code.
export function normalizeBackupCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, "");
}

// Keyed with the site's own secret (AUTH_SECRET): a copy of the database alone can't be tried
// offline, and a plain hash of about 50 bits let every admin's 10 codes be guessed at once on a GPU.
// Changing AUTH_SECRET ends the codes made under it, as it ends every session.
export function hashBackupCode(code: string): string {
  const secret = process.env.AUTH_SECRET;
  const text = normalizeBackupCode(code);
  return secret
    ? createHmac("sha256", `backup-code:${secret}`).update(text).digest("hex")
    : legacyHash(text);
}

// How codes were kept before they were keyed: still accepted, so nobody's printed codes stop working.
const legacyHash = (text: string) => createHash("sha256").update(text).digest("hex");

// Every way this code may be kept, for looking it up.
export function backupCodeHashes(code: string): string[] {
  return [...new Set([hashBackupCode(code), legacyHash(normalizeBackupCode(code))])];
}

// Fresh codes, formatted for showing once ("abcde-fghjk").
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const raw = Array.from(
      { length: BACKUP_CODE_LENGTH },
      () => ALPHABET[randomInt(ALPHABET.length)],
    );
    const half = BACKUP_CODE_LENGTH / 2;
    codes.add(`${raw.slice(0, half).join("")}-${raw.slice(half).join("")}`);
  }
  return [...codes];
}

// Looks like a backup code rather than a 6-digit authenticator code.
export function looksLikeBackupCode(code: string): boolean {
  return normalizeBackupCode(code).length === BACKUP_CODE_LENGTH;
}
