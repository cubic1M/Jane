import { randomBytes } from "node:crypto";
import { vi } from "vitest";

// A test's keys: a fresh token encryption key, and no Anthropic or Plaid keys, so nothing it
// runs reaches a real service. Undone by vi.unstubAllEnvs().
export function stubTestKeys(): void {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("PLAID_CLIENT_ID", "");
  vi.stubEnv("PLAID_SECRET", "");
}
