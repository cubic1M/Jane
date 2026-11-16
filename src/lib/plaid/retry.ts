import { RETRYABLE_PLAID_CODES, SYNC_RETRY_BASE_MS } from "@/config/plaid";
import { PlaidRequestError } from "./client";

// Retries for Plaid calls that fail for a reason that passes: a rate limit, an institution
// outage, Plaid's own server error, or no answer at all (a network error). Waits double each
// time, with some randomness; anything else (a sign-in needed, a bad request) fails at once.
// The sync's page reader retries with these (src/data-sources/plaid/plaid-source.ts).

export function retryablePlaidError(error: unknown): boolean {
  if (!(error instanceof PlaidRequestError)) return false;
  if (error.code && RETRYABLE_PLAID_CODES.includes(error.code)) return true;
  if (error.code?.startsWith("NETWORK_")) return true;
  if (error.code === null && error.status === null) return true;
  return error.status === 429 || (error.status !== null && error.status >= 500);
}

export const backoffMs = (attempt: number, base = SYNC_RETRY_BASE_MS, random = Math.random) =>
  Math.round(base * 2 ** attempt * (1 + random() / 4));
