import { createHash, randomInt } from "node:crypto";
import { BACKUP_CODE_COUNT, BACKUP_CODE_LENGTH } from "@/config/two-factor";

// No 0/O or 1/I/L, so codes copied from paper aren't misread.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

// Ignores case, spaces and dashes, so "ABCDE-FGHJK" and "abcde fghjk" are the same code.
export function normalizeBackupCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, "");
}

export function hashBackupCode(code: string): string {
  return createHash("sha256").update(normalizeBackupCode(code)).digest("hex");
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
