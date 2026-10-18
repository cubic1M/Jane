// Two-factor sign-in (spec steps 16 and 48). The code-guessing limit is the "mfa" entry in
// src/config/rate-limits.ts.

// Backup codes made at a time; each works once.
export const BACKUP_CODE_COUNT = 10;
// Characters per backup code (shown as two groups of five).
export const BACKUP_CODE_LENGTH = 10;
